const { Queue, Worker } = require('bullmq');
const cluster = require('cluster');
const transporter = require('../config/mailConfig');

console.log('Initializing mail service...');

// Create mail queue with better error handling
let mailQueue;
try {
  mailQueue = new Queue('mail-queue', {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Redis connection failed after 3 retries');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
    },
  });
  console.log('Mail queue created successfully');
} catch (queueError) {
  console.error('Failed to create mail queue:', queueError);
}

// Worker to process mail jobs - start in all processes
let mailWorker = null;

// Always start the worker (fix for non-clustered apps)
try {
  mailWorker = new Worker('mail-queue', async (job) => {
    console.log(`✅ PROCESSING MAIL JOB ${job.id} for ${job.data.to}`);
    try {
      const { to, cc, subject, text, html } = job.data;

      const mailOptions = {
        from: 'D-Map Alerts <' + process.env.EMAIL_USER + '>',
        to,
        cc,
        subject,
        text,
        html
      };

      console.log(`📤 SENDING EMAIL NOW to ${to}`);
      const result = await transporter.sendMail(mailOptions);
      console.log(`✅ MAIL SENT SUCCESSFULLY: ${result.response}`);
      return result;
    } catch (sendErr) {
      console.error(`❌ FAILED TO SEND MAIL JOB ${job.id}:`, sendErr.message);
      throw sendErr;
    }
  }, {
    connection: {
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('Worker Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    },
  });
  console.log('Mail worker created successfully');
} catch (workerError) {
  console.error('Failed to create mail worker:', workerError);
}

if (mailWorker) {
  mailWorker.on('completed', (job) => {
    console.log(`Mail worker completed job ${job.id} to ${job.data.to}`);
  });

  mailWorker.on('failed', (job, err) => {
    console.error(`Mail worker failed job ${job?.id} to ${job?.data?.to}:`, err);
  });

  mailWorker.on('error', (err) => {
    console.error('Mail worker error:', err);
  });

  mailWorker.on('waiting', (job) => {
    console.log(`Mail job ${job.id} is waiting in the queue`);
  });

  mailWorker.on('active', (job) => {
    console.log(`Mail job ${job.id} is now active`);
  });
}

// Function to send mail via queue
const sendMail = async (mailData) => {
  if (!mailQueue) {
    console.error('Mail queue not initialized!');
    throw new Error('Mail queue not available');
  }

  console.log('Adding mail job to queue:', mailData.to, 'Subject:', mailData.subject);

  try {
    await mailQueue.add('send-mail', mailData);
    console.log('Mail job added to queue successfully');
  } catch (addError) {
    console.error('Failed to add mail to queue:', addError);
    throw addError;
  }
};

module.exports = { sendMail };