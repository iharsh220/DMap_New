const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Will be set dynamically in the route
        cb(null, req.uploadPath);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    // Accept all file types for now
    cb(null, true);
};

// Create multer instance
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware to set upload path dynamically
const setUploadPath = (req, res, next) => {
    const { divisionName, projectName, dateStr } = req;
    const uploadPath = path.join('uploads', 'work-request', divisionName, `${projectName}_${dateStr}`);

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    req.uploadPath = uploadPath;
    next();
};

module.exports = {
    upload,
    setUploadPath
};