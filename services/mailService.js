const { Queue, Worker } = require('bullmq');
const transporter = require('../config/mailConfig');
const { getEmailImageAttachments } = require('./templateService');

console.log('Initializing mail service...');

// Shared Redis connection settings. Keep reconnecting with a capped back-off: giving up
// after a few retries used to stop all email until the API was restarted.
// BullMQ requires maxRetriesPerRequest: null for workers.
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 10000),
};

// Failed sends are retried (SMTP hiccups are usually temporary); finished jobs are trimmed
// so Redis does not keep every email body forever.
const MAIL_JOB_OPTIONS = {
  attempts: Number(process.env.MAIL_JOB_ATTEMPTS || 5),
  backoff: { type: 'exponential', delay: 30000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

// Matches the SMTP pool size in config/mailConfig.js
const MAIL_CONCURRENCY = Number(process.env.MAIL_CONCURRENCY || 5);

// Create mail queue with better error handling
let mailQueue;
try {
  mailQueue = new Queue('mail-queue', {
    connection: redisConnection,
    defaultJobOptions: MAIL_JOB_OPTIONS,
  });
  mailQueue.on('error', (err) => {
    console.error('Mail queue error:', err.message);
  });
  console.log('Mail queue created successfully');
} catch (queueError) {
  console.error('Failed to create mail queue:', queueError);
}

// Worker to process mail jobs (runs inside the API process)
let mailWorker = null;
try {
  mailWorker = new Worker('mail-queue', async (job) => {
    const { to, cc, subject, text, html } = job.data;

    const mailOptions = {
      from: 'D-Map Alerts <' + process.env.EMAIL_USER + '>',
      to,
      cc,
      subject,
      text,
      html,
      // Logo/banner are attached here (read from disk), so the queued job stays small
      attachments: getEmailImageAttachments(html),
    };

    const result = await transporter.sendMail(mailOptions);
    return { messageId: result.messageId, response: result.response };
  }, {
    connection: redisConnection,
    concurrency: MAIL_CONCURRENCY,
  });
  console.log('Mail worker created successfully');
} catch (workerError) {
  console.error('Failed to create mail worker:', workerError);
}

if (mailWorker) {
  mailWorker.on('completed', (job) => {
    console.log(`✅ Mail job ${job.id} sent to ${job.data.to}`);
  });

  mailWorker.on('failed', (job, err) => {
    const attempts = job ? `${job.attemptsMade}/${job.opts.attempts || 1}` : '';
    console.error(`❌ FAILED TO SEND MAIL JOB ${job?.id} to ${job?.data?.to} (attempt ${attempts}):`, err.message);
  });

  mailWorker.on('error', (err) => {
    console.error('Mail worker error:', err.message);
  });
}

// Queue an email. Never throws: the business action that triggered the email (task
// created, review saved, ...) has already been committed, so a Redis outage must not
// turn the API response into a 500. Returns the job, or null if it could not be queued.
const sendMail = async (mailData) => {
  if (!mailQueue) {
    console.error('Mail queue not initialized; email not sent:', mailData.to, mailData.subject);
    return null;
  }

  try {
    return await mailQueue.add('send-mail', mailData);
  } catch (addError) {
    console.error(`Failed to queue email to ${mailData.to} (${mailData.subject}):`, addError.message);
    return null;
  }
};

module.exports = { sendMail };
