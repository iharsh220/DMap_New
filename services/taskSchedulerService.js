const { Queue, Worker } = require('bullmq');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Tasks, WorkRequests, IssueAssignments, User, PmReviewReminderHistory } = require('../models');
const { sendMail } = require('./mailService');
const { renderTemplate } = require('./templateService');
const { recordPmReviewReminderHistory } = require('./historyService');
const { completeAllFinishedWorkRequests } = require('./workRequestCompletionService');

// Create task scheduler queue
const taskSchedulerQueue = new Queue('task-scheduler-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
});

// Worker to process task and issue status updates
const taskSchedulerWorker = new Worker('task-scheduler-queue', async (job) => {
  const { type } = job.data;

  if (type === 'progress_tasks') {
    return await progressTasksWithTodayStartDate();
  }

  if (type === 'progress_issues') {
    return await progressIssuesWithTodayStartDate();
  }

  if (type === 'pm_review_reminders') {
    return await sendPmReviewPendingReminders();
  }

  if (type === 'complete_work_requests') {
    return await completeAllFinishedWorkRequests();
  }

  throw new Error(`Unknown job type: ${type}`);
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
});

// Work requests in these statuses move to in_progress once one of their tasks/issues starts.
// Completed/cancelled/rejected requests are never pulled back.
const WORK_REQUEST_STATUSES_TO_PROGRESS = ['pending', 'accepted', 'assigned'];

const progressWorkRequests = async (workRequestIds) => {
  if (workRequestIds.length === 0) return 0;
  const [count] = await WorkRequests.update(
    { status: 'in_progress' },
    { where: { id: { [Op.in]: workRequestIds }, status: { [Op.in]: WORK_REQUEST_STATUSES_TO_PROGRESS } } }
  );
  return count;
};

// Function to progress tasks whose start date has arrived.
// Uses start_date <= today (not only == today) so tasks accepted after the
// 00:01 run, or missed while the server was down, are still picked up.
const progressTasksWithTodayStartDate = async () => {
  try {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const tasksToStart = await Tasks.findAll({
      where: {
        status: 'accepted',
        is_deleted: 0,
        start_date: { [Op.lt]: tomorrow },
        // a task the PM already finally approved is finished, never restart it
        [Op.not]: { review: 'approved', review_stage: 'final_approved' }
      },
      attributes: ['id', 'work_request_id'],
      raw: true
    });

    let updatedTasks = 0;
    if (tasksToStart.length > 0) {
      [updatedTasks] = await Tasks.update(
        { status: 'in_progress' },
        { where: { id: { [Op.in]: tasksToStart.map(t => t.id) }, status: 'accepted' } }
      );
    }
    const updatedWorkRequests = await progressWorkRequests([...new Set(tasksToStart.map(t => t.work_request_id))]);

    return {
      success: true,
      message: `Processed ${tasksToStart.length} tasks whose start date has arrived`,
      updatedTasks,
      updatedWorkRequests
    };
  } catch (error) {
    console.error('Error processing task deadline progression:', error);
    throw error;
  }
};

// Function to progress issues whose start date has arrived (see tasks above)
const progressIssuesWithTodayStartDate = async () => {
  try {
    const today = new Date();
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

    const issuesToStart = await IssueAssignments.findAll({
      where: {
        status: 'u_accepted',
        is_deleted: 0,
        start_date: { [Op.lt]: tomorrow }
      },
      attributes: ['id'],
      include: [{
        model: Tasks,
        as: 'task',
        attributes: ['work_request_id']
      }]
    });

    let updatedIssues = 0;
    if (issuesToStart.length > 0) {
      [updatedIssues] = await IssueAssignments.update(
        { status: 'in_progress' },
        { where: { id: { [Op.in]: issuesToStart.map(i => i.id) }, status: 'u_accepted' } }
      );
    }
    const workRequestIds = [...new Set(issuesToStart.map(i => i.task && i.task.work_request_id).filter(Boolean))];
    const updatedWorkRequests = await progressWorkRequests(workRequestIds);

    return {
      success: true,
      message: `Processed ${issuesToStart.length} issues whose start date has arrived`,
      updatedIssues,
      updatedWorkRequests
    };
  } catch (error) {
    console.error('Error processing issue deadline progression:', error);
    throw error;
  }
};

const formatDate = (date) => {
  if (!date) {
    return 'Not set';
  }

  return new Date(date).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const addReminderItem = (remindersByEmail, client, item) => {
  if (!client || !client.email) {
    return;
  }

  if (!remindersByEmail.has(client.email)) {
    remindersByEmail.set(client.email, {
      client,
      items: []
    });
  }

  remindersByEmail.get(client.email).items.push(item);
};

// Function to send daily reminders for pending PM/client reviews
// Daily PMT reminder ("your project's work is completed, please approve it"). It is sent only
// from production: it needs PM_REVIEW_REMINDER_ENABLED=true in .env, and it never runs when
// BASE_ROUTE is a UAT route, so UAT / local copies of the data never mail real requesters.
// PM_REVIEW_REMINDER_CRON overrides the schedule (default 09:00 IST, Monday to Saturday).
const PM_REVIEW_REMINDER_CRON = process.env.PM_REVIEW_REMINDER_CRON || '0 9 * * 1-6';

const pmReviewReminderStatus = () => {
  if (String(process.env.PM_REVIEW_REMINDER_ENABLED || '').toLowerCase() !== 'true') {
    return { enabled: false, reason: 'PM_REVIEW_REMINDER_ENABLED is not true' };
  }
  if (/(^|\/)uat(\/|$)/i.test(process.env.BASE_ROUTE || '')) {
    return { enabled: false, reason: 'UAT environment (BASE_ROUTE contains /uat/)' };
  }
  return { enabled: true };
};

// 'YYYY-MM-DD' of today in IST
const todayIst = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

const sendPmReviewPendingReminders = async ({ force = false } = {}) => {
  try {
    const status = pmReviewReminderStatus();
    if (!status.enabled && !force) {
      return { success: true, skipped: true, message: `PM review reminders are disabled: ${status.reason}` };
    }

    const remindersByEmail = new Map();
    const liveRequestWhere = { is_deleted: 0, status: { [Op.notIn]: ['cancelled', 'rejected'] } };

    const pendingTasks = await Tasks.findAll({
      where: {
        review: 'pending',
        review_stage: 'pm_review',
        is_deleted: 0
      },
      attributes: ['id', 'task_name', 'deadline', 'work_request_id', 'updated_at', 'shared_with_client_at'],
      include: [{
        model: WorkRequests,
        required: true,
        where: liveRequestWhere,
        attributes: ['id', 'project_name', 'brand', 'user_id'],
        include: [{
          model: User,
          as: 'users',
          required: true,
          where: { account_status: 'active' },
          attributes: ['id', 'name', 'email']
        }]
      }]
    });

    for (const task of pendingTasks) {
      const workRequest = task.WorkRequest;
      addReminderItem(remindersByEmail, workRequest?.users, {
        type: 'Task',
        id: task.id,
        name: task.task_name || `Task ${task.id}`,
        project_name: workRequest?.project_name || 'N/A',
        brand: workRequest?.brand || 'N/A',
        work_request_id: workRequest?.id || task.work_request_id,
        deadline: formatDate(task.deadline),
        pending_since: formatDate(task.shared_with_client_at || task.updated_at)
      });
    }

    const pendingIssues = await IssueAssignments.findAll({
      where: {
        review: 'pending',
        review_stage: 'pm_review',
        is_deleted: 0
      },
      attributes: ['id', 'version', 'description', 'deadline', 'task_id', 'updated_at'],
      include: [{
        model: Tasks,
        as: 'task',
        where: { is_deleted: 0 },
        attributes: ['id', 'task_name', 'work_request_id'],
        include: [{
          model: WorkRequests,
          required: true,
          where: liveRequestWhere,
          attributes: ['id', 'project_name', 'brand', 'user_id'],
          include: [{
            model: User,
            as: 'users',
            required: true,
            where: { account_status: 'active' },
            attributes: ['id', 'name', 'email']
          }]
        }]
      }]
    });

    for (const issue of pendingIssues) {
      const task = issue.task;
      const workRequest = task?.WorkRequest;
      addReminderItem(remindersByEmail, workRequest?.users, {
        type: 'Issue',
        id: issue.id,
        name: issue.version ? String(issue.version) : `#${issue.id}`,
        task_name: task?.task_name || 'N/A',
        project_name: workRequest?.project_name || 'N/A',
        brand: workRequest?.brand || 'N/A',
        work_request_id: workRequest?.id || task?.work_request_id || 'N/A',
        deadline: formatDate(issue.deadline),
        pending_since: formatDate(issue.updated_at)
      });
    }

    let sentEmails = 0;
    let skippedAlreadySent = 0;
    const startOfToday = `${todayIst()} 00:00:00`;

    for (const [email, reminder] of remindersByEmail.entries()) {
      // At most one reminder per requester per day (also when several API processes run the cron)
      if (!force) {
        const alreadySent = await PmReviewReminderHistory.findOne({
          where: { user_id: reminder.client.id, created_at: { [Op.gte]: startOfToday }, email_status: { [Op.in]: ['sent', 'queued'] } },
          attributes: ['id']
        });
        if (alreadySent) {
          skippedAlreadySent++;
          continue;
        }
      }

      const html = renderTemplate('pmReviewPendingReminder', {
        client_name: reminder.client.name || 'User',
        pending_count: reminder.items.length,
        items: reminder.items,
        frontend_url: process.env.FRONTEND_URL
      });

      // sendMail never throws; it returns null when the mail queue (Redis) is unavailable
      const queued = await sendMail({
        to: email,
        subject: `Reminder: ${reminder.items.length} item(s) waiting for your approval - D-Map`,
        html
      });

      if (queued) sentEmails++;

      for (const item of reminder.items) {
        await recordPmReviewReminderHistory({
          workRequestId: item.work_request_id,
          userId: reminder.client.id,
          taskId: item.type === 'Task' ? item.id : null,
          issueAssignmentId: item.type === 'Issue' ? item.id : null,
          itemsCount: reminder.items.length,
          itemsData: reminder.items,
          emailStatus: queued ? 'queued' : 'failed'
        });
      }

      if (sentEmails < remindersByEmail.size) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return {
      success: true,
      message: `Queued ${sentEmails} PM review reminder email(s)`,
      skippedAlreadySent,
      pendingTasks: pendingTasks.length,
      pendingIssues: pendingIssues.length,
      sentEmails
    };
  } catch (error) {
    console.error('Error sending PM review pending reminders:', error);
    throw error;
  }
};

// Function to schedule the daily task and issue progression job
const scheduleTaskProgression = () => {
  // Runs at 12:01 AM IST
  cron.schedule('1 0 * * *', async () => {
    console.log("Running scheduled task: New day task and issue progression");

    try {
      // Progress tasks with today's start date
      await taskSchedulerQueue.add('progress-tasks', { type: 'progress_tasks' });
      console.log('Task progression job queued successfully');

      // Progress issues with today's start date
      await taskSchedulerQueue.add('progress-issues', { type: 'progress_issues' });
      console.log('Issue progression job queued successfully');

      // Complete work requests whose tasks and change requests are all completed and approved
      await taskSchedulerQueue.add('complete-work-requests', { type: 'complete_work_requests' });
      console.log('Work request completion job queued successfully');
    } catch (error) {
      console.error('Failed to queue task/issue progression job:', error);
    }
  }, {
    timezone: 'Asia/Kolkata'
  });

  // Daily reminder to requesters (PMT) about completed work waiting for their approval.
  // Production only, see pmReviewReminderStatus().
  const reminderStatus = pmReviewReminderStatus();
  if (reminderStatus.enabled) {
    cron.schedule(PM_REVIEW_REMINDER_CRON, async () => {
      console.log('Running scheduled task: PM review pending reminders');
      try {
        await taskSchedulerQueue.add('pm-review-reminders', { type: 'pm_review_reminders' });
        console.log('PM review reminder job queued successfully');
      } catch (error) {
        console.error('Failed to queue PM review reminder job:', error);
      }
    }, {
      timezone: 'Asia/Kolkata'
    });
  }

  console.log('Task and Issue progression + work request completion scheduler initialized - runs daily at 12:01 AM IST');
  console.log(reminderStatus.enabled
    ? `PM review reminder scheduler initialized - cron '${PM_REVIEW_REMINDER_CRON}' (Asia/Kolkata)`
    : `PM review reminder scheduler is off: ${reminderStatus.reason}`);
};


// Function to manually trigger task progression (for testing)
const triggerTaskProgression = async () => {
  try {
    const result = await taskSchedulerQueue.add('progress-tasks', { type: 'progress_tasks' });
    return result;
  } catch (error) {
    console.error('Failed to trigger task progression:', error);
    throw error;
  }
};

// Function to manually trigger issue progression (for testing)
const triggerIssueProgression = async () => {
  try {
    const result = await taskSchedulerQueue.add('progress-issues', { type: 'progress_issues' });
    return result;
  } catch (error) {
    console.error('Failed to trigger issue progression:', error);
    throw error;
  }
};

// Function to manually trigger the work request completion check (for testing)
const triggerWorkRequestCompletion = async () => {
  try {
    const result = await taskSchedulerQueue.add('complete-work-requests', { type: 'complete_work_requests' });
    return result;
  } catch (error) {
    console.error('Failed to trigger work request completion:', error);
    throw error;
  }
};

// Function to manually trigger PM review reminder emails (for testing)
const triggerPmReviewPendingReminders = async () => {
  try {
    const result = await taskSchedulerQueue.add('pm-review-reminders', { type: 'pm_review_reminders' });
    return result;
  } catch (error) {
    console.error('Failed to trigger PM review pending reminders:', error);
    throw error;
  }
};

taskSchedulerWorker.on('completed', (job) => {
  console.log(`Task scheduler job ${job.id} completed:`, job.returnvalue);
});

taskSchedulerWorker.on('failed', (job, err) => {
  console.error(`Task scheduler job ${job.id} failed:`, err);
});

module.exports = {
  scheduleTaskProgression,
  triggerTaskProgression,
  triggerIssueProgression,
  triggerPmReviewPendingReminders,
  triggerWorkRequestCompletion,
  progressTasksWithTodayStartDate,
  progressIssuesWithTodayStartDate,
  sendPmReviewPendingReminders,
  pmReviewReminderStatus,
  completeAllFinishedWorkRequests
};
