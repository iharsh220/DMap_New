const { Queue, Worker } = require('bullmq');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Tasks, WorkRequests, IssueAssignments, User } = require('../models');
const { sendMail } = require('./mailService');
const { renderTemplate } = require('./templateService');

// Create task scheduler queue
const taskSchedulerQueue = new Queue('task-scheduler-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
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

  throw new Error(`Unknown job type: ${type}`);
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

// Function to progress tasks with today's start date
const progressTasksWithTodayStartDate = async () => {
  try {
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Find all tasks with start_date today and status 'accepted'
    const tasksWithTodayStartDate = await Tasks.findAll({
      where: {
        status: 'accepted',
        start_date: {
          [Op.gte]: todayDate,
          [Op.lt]: new Date(todayDate.getTime() + 24 * 60 * 60 * 1000) // Next day
        }
      },
      include: [{
        model: WorkRequests,
        attributes: ['id', 'status']
      }]
    });

    let updatedTasks = 0;
    let updatedWorkRequests = 0;

    for (const task of tasksWithTodayStartDate) {
      // Update task status to 'in_progress'
      await Tasks.update(
        { status: 'in_progress' },
        { where: { id: task.id } }
      );
      updatedTasks++;

      // Update work request status to 'in_progress' if it's not already
      if (task.WorkRequest && task.WorkRequest.status !== 'in_progress') {
        await WorkRequests.update(
          { status: 'in_progress' },
          { where: { id: task.work_request_id } }
        );
        updatedWorkRequests++;
      }
    }

    return {
      success: true,
      message: `Processed ${tasksWithTodayStartDate.length} tasks with today's start date`,
      updatedTasks,
      updatedWorkRequests
    };
  } catch (error) {
    console.error('Error processing task deadline progression:', error);
    throw error;
  }
};

// Function to progress issues with today's start date
const progressIssuesWithTodayStartDate = async () => {
  try {
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // Find all issues with start_date today and status 'u_accepted'
    const issuesWithTodayStartDate = await IssueAssignments.findAll({
      where: {
        status: 'u_accepted',
        start_date: {
          [Op.gte]: todayDate,
          [Op.lt]: new Date(todayDate.getTime() + 24 * 60 * 60 * 1000) // Next day
        }
      },
      include: [{
        model: Tasks,
        as: 'task',
        attributes: ['id', 'work_request_id'],
        include: [{
          model: WorkRequests,
          attributes: ['id', 'status']
        }]
      }]
    });

    let updatedIssues = 0;
    let updatedWorkRequests = 0;

    for (const issue of issuesWithTodayStartDate) {
      // Update issue status to 'in_progress'
      await IssueAssignments.update(
        { status: 'in_progress' },
        { where: { id: issue.id } }
      );
      updatedIssues++;

      // Update work request status to 'in_progress' if it's not already
      if (issue.task && issue.task.WorkRequest && issue.task.WorkRequest.status !== 'in_progress') {
        await WorkRequests.update(
          { status: 'in_progress' },
          { where: { id: issue.task.work_request_id } }
        );
        updatedWorkRequests++;
      }
    }

    return {
      success: true,
      message: `Processed ${issuesWithTodayStartDate.length} issues with today's start date`,
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
const sendPmReviewPendingReminders = async () => {
  try {
    const remindersByEmail = new Map();

    const pendingTasks = await Tasks.findAll({
      where: {
        review: 'pending',
        review_stage: 'pm_review'
      },
      attributes: ['id', 'task_name', 'deadline', 'work_request_id', 'updated_at'],
      include: [{
        model: WorkRequests,
        attributes: ['id', 'project_name', 'brand', 'user_id'],
        include: [{
          model: User,
          as: 'users',
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
        pending_since: formatDate(task.updated_at)
      });
    }

    const pendingIssues = await IssueAssignments.findAll({
      where: {
        review: 'pending',
        review_stage: 'pm_review'
      },
      attributes: ['id', 'version', 'description', 'deadline', 'task_id', 'updated_at'],
      include: [{
        model: Tasks,
        as: 'task',
        attributes: ['id', 'task_name', 'work_request_id'],
        include: [{
          model: WorkRequests,
          attributes: ['id', 'project_name', 'brand', 'user_id'],
          include: [{
            model: User,
            as: 'users',
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
        name: issue.version ? `Issue ${issue.version}` : `Issue ${issue.id}`,
        task_name: task?.task_name || 'N/A',
        project_name: workRequest?.project_name || 'N/A',
        brand: workRequest?.brand || 'N/A',
        work_request_id: workRequest?.id || task?.work_request_id || 'N/A',
        deadline: formatDate(issue.deadline),
        pending_since: formatDate(issue.updated_at)
      });
    }

    let sentEmails = 0;

    for (const [email, reminder] of remindersByEmail.entries()) {
      const html = renderTemplate('pmReviewPendingReminder', {
        client_name: reminder.client.name || 'User',
        pending_count: reminder.items.length,
        items: reminder.items,
        frontend_url: process.env.FRONTEND_URL
      });

      await sendMail({
        to: email,
        subject: `Pending PM Review Reminder (${reminder.items.length})`,
        html
      });

      sentEmails++;
    }

    return {
      success: true,
      message: `Sent ${sentEmails} PM review reminder email(s)`,
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
    } catch (error) {
      console.error('Failed to queue task/issue progression job:', error);
    }
  }, {
    timezone: 'Asia/Kolkata'
  });

  // Runs daily at 9:00 AM IST
  cron.schedule('0 9 * * *', async () => {
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

  console.log('Task and Issue progression scheduler initialized - runs daily at 12:01 AM IST (checks start_date)');
  console.log('PM review reminder scheduler initialized - runs daily at 9:00 AM IST');
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
  progressTasksWithTodayStartDate,
  progressIssuesWithTodayStartDate,
  sendPmReviewPendingReminders
};
