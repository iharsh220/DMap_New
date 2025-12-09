const { Queue, Worker } = require('bullmq');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { WorkRequestDocuments } = require('../models');

const fileUploadQueue = new Queue('file-upload-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

fileUploadQueue.on('ready', () => {
  console.log('File upload queue is ready and connected to Redis');
});

fileUploadQueue.on('error', (err) => {
  console.error('File upload queue error:', err);
});

// Worker to process file upload jobs
const fileUploadWorker = new Worker('file-upload-queue', async (job) => {
  const { documentId, tempFilepath, uploadPath, filename, type = 'work_request' } = job.data;

  console.log(`Processing file upload job ${job.id} for document ${documentId}`);

  try {
    // Ensure upload directory exists
    if (!fsSync.existsSync(uploadPath)) {
      fsSync.mkdirSync(uploadPath, { recursive: true });
    }

    const finalFilepath = path.join(uploadPath, filename);

    console.log(`Moving file from ${tempFilepath} to ${finalFilepath}`);

    // Check if temp file exists
    if (!fsSync.existsSync(tempFilepath)) {
      throw new Error(`Temp file does not exist: ${tempFilepath}`);
    }

    // Check if upload directory exists and create if needed
    if (!fsSync.existsSync(uploadPath)) {
      console.log(`Creating upload directory: ${uploadPath}`);
      fsSync.mkdirSync(uploadPath, { recursive: true });
    }

    // Move file from temp location to final location
    fsSync.renameSync(tempFilepath, finalFilepath);

    console.log(`File moved successfully to ${finalFilepath}`);

    // Clean up temp directory (now unique per file)
    const tempDir = path.dirname(tempFilepath);
    try {
      fsSync.rmdirSync(tempDir);
    } catch (e) {
      // Directory might not be empty or already deleted, ignore
    }

    // Update document status to uploaded
    if (type === 'task') {
      const { TaskDocuments } = require('../models');
      await TaskDocuments.update(
        { status: 'uploaded' },
        { where: { id: documentId } }
      );
    } else {
      await WorkRequestDocuments.update(
        { status: 'uploaded' },
        { where: { id: documentId } }
      );
    }

    return { success: true, filepath: finalFilepath };
  } catch (error) {
    // Clean up temp directory on error
    try {
      const tempDir = path.dirname(tempFilepath);
      if (fsSync.existsSync(tempDir)) {
        fsSync.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup temp directory:', cleanupError);
    }

    // Update document status to failed
    if (type === 'task') {
      const { TaskDocuments } = require('../models');
      await TaskDocuments.update(
        { status: 'failed' },
        { where: { id: documentId } }
      );
    } else {
      await WorkRequestDocuments.update(
        { status: 'failed' },
        { where: { id: documentId } }
      );
    }
    throw error;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    username: process.env.REDIS_USERNAME,
  },
});

fileUploadWorker.on('ready', () => {
  console.log('File upload worker is ready and connected to Redis');
});

fileUploadWorker.on('error', (err) => {
  console.error('File upload worker error:', err);
});

fileUploadWorker.on('completed', (job) => {
  console.log(`File uploaded successfully for job ${job.id}`);
});

fileUploadWorker.on('failed', async (job, err) => {
  console.error(`File upload failed for job ${job.id}:`, err);

  const { documentId, tempFilepath, type = 'work_request' } = job.data;

  // Update document status to failed
  try {
    if (type === 'task') {
      const { TaskDocuments } = require('../models');
      await TaskDocuments.update(
        { status: 'failed' },
        { where: { id: documentId } }
      );
    } else {
      await WorkRequestDocuments.update(
        { status: 'failed' },
        { where: { id: documentId } }
      );
    }
  } catch (updateError) {
    console.error('Error updating document status to failed:', updateError);
  }

  // Remove temp directory
  try {
    const tempDir = path.dirname(tempFilepath);
    if (fsSync.existsSync(tempDir)) {
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch (removeError) {
    console.error('Error removing temp directory:', removeError);
  }
});

// Function to queue file upload
const queueFileUpload = async (uploadData) => {
  try {
    console.log('Adding file upload job to queue:', uploadData);
    const job = await fileUploadQueue.add('upload-file', uploadData);
    console.log('File upload job added successfully, job ID:', job.id);
    return job;
  } catch (error) {
    console.error('Failed to add file upload job to queue:', error);
    throw error;
  }
};

module.exports = { queueFileUpload };