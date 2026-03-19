import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';

import mlib from './mover.js';

const debug = process.env.debug === "true";
if (debug) console.log("Debug mode is ON");
const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const movers = [];

const blockChannels = [];

function getState() {
    return {
        movers,
    }
}

function updateState() {
    const state = getState();
    const message = JSON.stringify({
        type: 'STATE',
        state
    });
    clients.forEach((client) => {
        client.send(message);
    });

}

const clients = [];

wss.on('connection', (ws) => {
    console.log('Client connected!');

    clients.push(ws);

    ws.send(JSON.stringify({
        type: 'STATE',
        state: getState()
    }))

    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        console.log(msg);
        switch (msg.type) {
            case 'CREATE_MOVER': {
                if (blockChannels.includes(msg.channel)) {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: `Channel ${msg.channel} is already in use by another mover. Please choose a different channel.`
                    }));
                    return;
                }
                for (let i = msg.channel; i < msg.channel + 15; i++)
                    blockChannels.push(i);
                movers.push(new mlib.Mover(msg.channel, debug));
                updateState();
                break;
            }
            case 'MOVER_SET': {
                const mover = movers.find(m => m.channel === msg.channel);
                if (!mover) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: `No mover at channel ${msg.channel}` }));
                    return;
                }
                mover.set(msg.values);
                updateState();
                break;
            }
            case 'GET_STATE': {
                ws.send(JSON.stringify({
                    type: 'STATE',
                    state: getState()
                }));
                break;
            }
            default: {
                console.log("Received unknown message: ", msg);
            }
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected!');
        const index = clients.indexOf(ws);
        if (index !== -1) {
            clients.splice(index, 1);
        }
    });
});

server.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
}); 