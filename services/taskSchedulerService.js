const { Queue, Worker } = require('bullmq');
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Tasks, WorkRequests, IssueAssignments, WorkRequestManagers } = require('../models');

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

  console.log('Task and Issue progression scheduler initialized - runs daily at 12:01 AM IST (checks start_date)');
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
  progressTasksWithTodayStartDate,
  progressIssuesWithTodayStartDate
};