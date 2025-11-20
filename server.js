const cluster = require('cluster');
const os = require('os');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { connectDB } = require('./config/databaseConfig');
const http = require('http');
const socketIo = require('socket.io');
require('./models'); // Initialize models
require('dotenv').config();

if (cluster.isMaster) {
    const numCPUs = os.cpus().length;
    console.log(`Master ${process.pid} is running`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died`);
        cluster.fork(); // Restart worker
    });
} else {

    const app = express();
    const server = http.createServer(app);
    const io = socketIo(server);
    
    // Socket.io setup
    const apiIo = io.of('/digilabs/dmap/api/socket');
    
    apiIo.on('connection', (socket) => {
      // console.log(`✅ User connected to API namespace: ${socket.id}`);
    
      socket.on('disconnect', () => {
        // console.log(`❌ User disconnected: ${socket.id}`);
      });
    });
    
    // Make io accessible in routes
    app.set('io', io);
    app.set('apiIo', apiIo);
    
    // Middleware
    app.use(helmet());
    app.use(cors());
    app.use(compression());
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Rate limiting
    const limiter = require('./middleware/rateLimitMiddleware');
    app.use(limiter);

    // Base route
    const baseRoute = '/digilabs/dmap/api';

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
    
    server.listen(PORT, () => {
      console.log(`Worker ${process.pid} started, server running on port ${PORT}`);
    });

    module.exports = app;
}