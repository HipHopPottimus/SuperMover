import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';

import mlib from './mover.js';
import jlib from "./joystick.js";

const USE_FINE_CONTROL = false;

const debug = process.env.debug === "true";
if (debug) console.log("Debug mode is ON");
const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

let movers = [new mlib.Mover(1, debug)];
const primaryMover = movers[0];

let joystick1 = {};

try {
    joystick1 = new jlib.Joystick(0x046d, 0xc214);
}
catch(error) {
    console.error("Error when initializing joystick", error);
}

joystick1.onData = joystick1.onUpdate = () => {
    const values = {
        Zoom: Math.round(joystick1.zoom),
        Dimmer: joystick1.throttle,
    };

    primaryMover.set(values);
    primaryMover.setPanDeg(joystick1.x  / 255 * 540, USE_FINE_CONTROL);
    primaryMover.setTiltDeg(joystick1.y / 255 * 270, USE_FINE_CONTROL);
    updateState();
};

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
                if(msg.channel === primaryMover.channel) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot forget the primary mover!' }));
                    return;
                }
                movers = movers.filter(m => m.channel != msg.channel);
                for(let channel = msg.channel; channel < msg.channel + 15; channel++)
                    blockedChannels.delete(channel);
                break;
            }
            case 'MOVER_SET': {
                const mover = movers.find(m => m.channel === msg.channel);
                if (!mover) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: `No mover at channel ${msg.channel}` }));
                    return;
                }

                if(mover.channel === primaryMover.channel) {
                    if(msg.values.Zoom !== undefined) 
                        joystick1.zoom = msg.values.Zoom;
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