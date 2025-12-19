const express = require('express');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require("socket.io");
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Make io available in routes
app.set('io', io);

// API Routes
const apiRoutes = require('./api');
app.use('/api', apiRoutes);

const { initBot } = require('./bot');
initBot(io);

app.get('/', (req, res, next) => {
    // If request accepts html, try to serve index.html (SPA) or next()
    if (req.accepts('html')) {
        // Check if we are in production (dist folder exists)
        const distPath = path.join(__dirname, '../web/dist');
        if (require('fs').existsSync(distPath)) {
            return res.sendFile(path.join(distPath, 'index.html'));
        }
    }
    next();
});

// Serve Static files for production
const distPath = path.join(__dirname, '../web/dist');
if (require('fs').existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA Fallback
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(distPath, 'index.html'));
        }
    });
} else {
    app.get('/', (req, res) => res.send('Telegram Forwarder Bot API is running (Dev Mode)'));
}

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
