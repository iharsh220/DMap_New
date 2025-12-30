const { Queue, Worker } = require('bullmq');
const cluster = require('cluster');
const transporter = require('../config/mailConfig');

// Create mail queue
const mailQueue = new Queue('mail-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

// Worker to process mail jobs - start in all processes
let mailWorker = null;

// Always start the worker (fix for non-clustered apps)
mailWorker = new Worker('mail-queue', async (job) => {
  console.log(`Processing mail job ${job.id} for ${job.data.to}`);
  const { to, cc, subject, text, html } = job.data;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    cc,
    subject,
    text,
    html
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    console.log(`Mail sent successfully for job ${job.id} to ${job.data.to}`);
    return result;
  } catch (error) {
    console.error(`Mail failed for job ${job.id} to ${job.data.to}:`, error);
    throw error;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

mailWorker.on('completed', (job) => {
  console.log(`Mail worker completed job ${job.id} to ${job.data.to}`);
});

mailWorker.on('failed', (job, err) => {
  console.error(`Mail worker failed job ${job.id} to ${job.data.to}:`, err);
});

// Function to send mail via queue
const sendMail = async (mailData) => {
  console.log('Adding mail job to queue:', mailData.to);
  await mailQueue.add('send-mail', mailData);
};

module.exports = { sendMail };