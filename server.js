const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const fileUpload = require('express-fileupload');
const path = require('path');
const { connectDB } = require('./config/databaseConfig');
const http = require('http');
const socketIo = require('socket.io');
require('./models'); // Initialize models
require('dotenv').config();

// Initialize task scheduler
const { scheduleTaskProgression } = require('./services/taskSchedulerService');

// Base route
const baseRoute = process.env.BASE_ROUTE || '/digilabs/uat/dmap/api/';

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// --- SOCKET.IO SETUP ---
const io = socketIo(server, {
    path: `${process.env.BASE_ROUTE}socket.io`, // This must match the client "path" option
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
    credentials: false,
    allowedHeaders: ["Content-Type", "Authorization", "x-socket-id", "X-Requested-With"],
    exposedHeaders: ["x-socket-id", "Authorization"]
}));

app.use(compression({
    skip: function (req, res) {
        if (req.path && req.path.indexOf('/upload/progress/') !== -1) {
            return true;
        }
        return false;
    }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use('/uploads', express.static('uploads'));

// Static files
app.use(baseRoute, express.static(path.join(__dirname, 'public')));

// Logging middleware

// const loggingMiddleware = require('./middleware/loggingMiddleware');
// app.use(loggingMiddleware);

// Rate limiting
// const limiter = require('./middleware/rateLimitMiddleware');
// app.use(limiter);

// R5: a 5xx response never exposes internal error text (SQL errors, file paths) to the client.
// Handlers keep sending { success: false, error: error.message }; here the real text is logged
// with context (endpoint, user id, ids) and the client gets a generic message in the same shape.
const GENERIC_SERVER_ERROR = 'Something went wrong. Please try again later.';
app.use((req, res, next) => {
    const sendJson = res.json.bind(res);
    res.json = (body) => {
        if (res.statusCode >= 500 && body && typeof body === 'object' && !Array.isArray(body) && typeof body.error === 'string' && body.error !== GENERIC_SERVER_ERROR) {
            console.error('[api 5xx]', JSON.stringify({
                status: res.statusCode,
                endpoint: `${req.method} ${req.originalUrl}`,
                user_id: req.user ? req.user.id : null,
                params: req.params,
                error: body.error,
                message: body.message
            }));
            body = { ...body, error: GENERIC_SERVER_ERROR };
        }
        return sendJson(body);
    };
    next();
});

// Routes
app.use(baseRoute, require('./routes/indexRoute'));

// Health check
app.get(`${baseRoute}/health`, (req, res) => {
    res.json({ status: 'OK', message: 'D-Map API is running' });
});

// Redirect root to login page
const basePath = baseRoute.endsWith('/') ? baseRoute.slice(0, -1) : baseRoute;
app.get('/', (req, res) => res.redirect(`${basePath}/datatable/admin/login`));
app.get(baseRoute, (req, res) => res.redirect(`${basePath}/datatable/admin/login`));

// Error handling middleware
app.use((err, req, res, next) => {
    // Malformed JSON body is a client error, not a server failure
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
    }
    console.error('[api error]', `${req.method} ${req.originalUrl}`, 'user', req.user ? req.user.id : null, err.stack);
    res.status(err.status && err.status < 500 ? err.status : 500).json({ success: false, error: err.status && err.status < 500 ? err.message : GENERIC_SERVER_ERROR });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// A rejected promise nobody awaited (e.g. a fire-and-forget email or history write) is logged
// instead of crashing the API process (Node's default for unhandled rejections)
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});

const PORT = process.env.PORT || 1007;

// Connect to database
connectDB();

// Initialize task scheduler
scheduleTaskProgression();

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;