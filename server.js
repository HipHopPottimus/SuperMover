import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';

const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected!');

    ws.on('message', (message) => {
        console.log(`Received: ${message}`);
    });
});

server.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
}); 