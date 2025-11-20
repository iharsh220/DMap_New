const { Queue, Worker } = require('bullmq');
const transporter = require('../config/mailConfig');
const { renderTemplate } = require('./templateService');

// Create mail queue
const mailQueue = new Queue('mail-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

// Worker to process mail jobs
const mailWorker = new Worker('mail-queue', async (job) => {
  const { to, cc, subject, text, html } = job.data;

  const mailOptions = {
    from: process.env.MAIL_USER,
    to,
    cc,
    subject,
    text,
    html
  };

  return transporter.sendMail(mailOptions);
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

mailWorker.on('completed', (job) => {
  console.log(`Mail sent successfully for job ${job.id}`);
});

mailWorker.on('failed', (job, err) => {
  console.error(`Mail failed for job ${job.id}:`, err);
});

// Function to send mail via queue
const sendMail = async (mailData) => {
  await mailQueue.add('send-mail', mailData);
};

module.exports = { sendMail };