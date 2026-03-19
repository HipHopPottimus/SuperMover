import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';

import mlib from './mover.js';
import joystick from "./joystick.js";

const debug = process.env.debug === "true";
if (debug) console.log("Debug mode is ON");
const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const movers = [new mlib.Mover(1, debug)];
const primaryMover = movers[0];

const joystick1 = new joystick.Joystick(0x046d, 0xc214);

joystick1.onData = () => {
    const values = {
        Pan: Math.round(joystick1.x),
        Tilt: Math.round(joystick1.y),
        Zoom: Math.round(joystick1.zoom),
        Dimmer: joystick1.throttle,
    };

    primaryMover.set(values);
    updateState();
};

joystick1.onUpdate = () => {
    const values = {
        Pan: Math.round(joystick1.x),
        Tilt: Math.round(joystick1.y),
        Zoom: Math.round(joystick1.zoom),
        Dimmer: joystick1.throttle,
    };

    primaryMover.set(values);
    updateState();
}

const blockedChannels = new Set(Array.from({ length: 15 }, (_, index) => index + 1));

function getState() {
    return {
        movers,
    };
}

function updateState() {
    const state = getState();
    const message = JSON.stringify({ type: 'STATE', state });

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

const clients = [];

function isChannelBlocked(channel) {
    return blockedChannels.has(channel);
}

function blockMoverChannels(startChannel) {
    for (let channel = startChannel; channel < startChannel + 15; channel++) {
        blockedChannels.add(channel);
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected!');

    clients.push(ws);

    ws.send(JSON.stringify({
        type: 'STATE',
        state: getState(),
    }));

    ws.on('message', (message) => {
        let msg;

        try {
            msg = JSON.parse(message.toString());
        } catch {
            ws.send(JSON.stringify({
                type: 'ERROR',
                message: 'Invalid JSON message received.',
            }));
            return;
        }

        if (debug) console.log(msg);

        switch (msg.type) {
            case 'CREATE_MOVER': {
                if (isChannelBlocked(msg.channel)) {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: `Channel ${msg.channel} is already in use by another mover. Please choose a different channel.`
                    }));
                    return;
                }

                blockMoverChannels(msg.channel);
                movers.push(new mlib.Mover(msg.channel, debug));
                updateState();
                break;
            }
            case 'FORGET_MOVER': {
                movers = movers.filter(m => m.channel != msg.channel);
                blockChannels = blockChannels.filter(block => block < msg.channel && block > msg.channel + 15);
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
                    state: getState(),
                }));
                break;
            }
            default: {
                console.log("Received unknown message: ", msg);
            }
        }
    });

    ws.on('close', () => {
        if (debug) console.log('Client disconnected!');
        const index = clients.indexOf(ws);
        if (index !== -1) {
            clients.splice(index, 1);
        }
    });
});

server.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
}); 