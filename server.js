const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const fileUpload = require('express-fileupload');
const { connectDB } = require('./config/databaseConfig');
const http = require('http');
const socketIo = require('socket.io');
require('./models'); // Initialize models
require('dotenv').config();

// Initialize task scheduler
const { scheduleTaskProgression } = require('./services/taskSchedulerService');

// Base route
const baseRoute = process.env.BASE_ROUTE || '/digilabs/dmap/api';

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// --- SOCKET.IO SETUP ---
const io = socketIo(server, {
    path: '/digilabs/dmap/api/socket.io', // This must match the client "path" option
    cors: {
        origin: "*", // Allow all origins
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'] // Ensure both transports are enabled
});

// 1. Target Namespace (Correct One)
const apiIo = io.of(`/socket`);
apiIo.on('connection', (socket) => {
    console.log(`✅ User connected to API namespace (/socket): ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`❌ User disconnected from API namespace: ${socket.id}`);
    });
});

app.set('apiIo', apiIo);

// --- MIDDLEWARE ---
app.use(helmet({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: false
}));

app.use(cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "x-socket-id", "X-Requested-With"],
    exposedHeaders: ["x-socket-id", "Authorization"]
}));

app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use('/uploads', express.static('uploads'));

// Logging middleware
const loggingMiddleware = require('./middleware/loggingMiddleware');
app.use(loggingMiddleware);

// Rate limiting
// const limiter = require('./middleware/rateLimitMiddleware');
// app.use(limiter);

// Routes
app.use(baseRoute, require('./routes/indexRoute'));

// Health check
app.get(`${baseRoute}/health`, (req, res) => {
    res.json({ status: 'OK', message: 'D-Map API is running' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 1005;

// Connect to database
connectDB();

// Initialize task scheduler
scheduleTaskProgression();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;