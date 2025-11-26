const { Queue, Worker } = require('bullmq');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { WorkRequestDocuments } = require('../models');

// Create file upload queue
const fileUploadQueue = new Queue('file-upload-queue', {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

// Worker to process file upload jobs
const fileUploadWorker = new Worker('file-upload-queue', async (job) => {
  const { documentId, tempFilepath, uploadPath, filename } = job.data;

  try {
    // Ensure upload directory exists
    if (!fsSync.existsSync(uploadPath)) {
      fsSync.mkdirSync(uploadPath, { recursive: true });
    }

    const finalFilepath = path.join(uploadPath, filename);

    // Move file from temp location to final location
    fsSync.renameSync(tempFilepath, finalFilepath);

    // Clean up temp directory if empty
    const tempDir = path.dirname(tempFilepath);
    try {
      fsSync.rmdirSync(tempDir);
    } catch (e) {
      // Directory not empty, ignore
    }

    // Update document status to uploaded
    await WorkRequestDocuments.update(
      { status: 'uploaded' },
      { where: { id: documentId } }
    );

    return { success: true, filepath: finalFilepath };
  } catch (error) {
    // Clean up temp file on error
    try {
      if (fsSync.existsSync(tempFilepath)) {
        fsSync.unlinkSync(tempFilepath);
      }
    } catch (cleanupError) {
      console.error('Failed to cleanup temp file:', cleanupError);
    }

    // Update document status to failed
    await WorkRequestDocuments.update(
      { status: 'failed' },
      { where: { id: documentId } }
    );
    throw error;
  }
}, {
  connection: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
  },
});

fileUploadWorker.on('completed', (job) => {
  console.log(`File uploaded successfully for job ${job.id}`);
});

fileUploadWorker.on('failed', (job, err) => {
  console.error(`File upload failed for job ${job.id}:`, err);
});

// Function to queue file upload
const queueFileUpload = async (uploadData) => {
  await fileUploadQueue.add('upload-file', uploadData);
};

module.exports = { queueFileUpload };