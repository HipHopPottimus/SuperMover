import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import path from 'path';

import mlib from './mover.js';
import jlib from "./joystick.js";
import glib from "./gamepad.js";

const USE_FINE_CONTROL = true;

const debug = process.env.debug === "true" || process.argv.includes("--debug");
if (debug) console.log("Debug mode is ON");
const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

let movers = [new mlib.Mover(1, debug), new mlib.Mover(16, debug)];
const primaryMover = movers[0];
const gamepadMover = movers[1];

let joystick1 = {};

try {
    joystick1 = new jlib.Joystick(0x046d, 0xc214);
}
catch(error) {
    console.error("Error when initializing joystick", error);
    if(process.argv.includes("--dummy-joystick-updates")) setInterval(() => {
        if(joystick1.onUpdate) joystick1.onUpdate({zoom: 128, throttle: 128, x: 128, y: 128});
    }, 50);
}

let gamepad1 = {};

try {
    gamepad1 = new glib.Gamepad(0);
    console.log("Gamepad initialized on controller index 0");
} catch(error) {
    console.error("Error when initializing gamepad", error);
}

gamepad1.onUpdate = () => {
    const panValue = Math.round(gamepad1.x / 255 * 65535);
    const tiltValue = Math.round(gamepad1.y / 255 * 65535);
    gamepadMover.setChannels({
        [gamepadMover.CHANNELS.Zoom]: Math.round(gamepad1.zoom),
        [gamepadMover.CHANNELS.Dimmer]: Math.round(gamepad1.dimmer),
        [gamepadMover.CHANNELS.Pan]: panValue >> 8 & 0xFF,
        [gamepadMover.CHANNELS.PanFine]: panValue & 0xFF,
        [gamepadMover.CHANNELS.Tilt]: tiltValue >> 8 & 0xFF,
        [gamepadMover.CHANNELS.TiltFine]: tiltValue & 0xFF,
    });
    updateState();
};

joystick1.onUpdate = () => {
    const panValue = Math.round(joystick1.x / 255 * 65535);
    const tiltValue = Math.round(joystick1.y / 255 * 65535);
    primaryMover.setChannels({
        [primaryMover.CHANNELS.Zoom]: Math.round(joystick1.zoom),
        [primaryMover.CHANNELS.Dimmer]: joystick1.throttle,
        [primaryMover.CHANNELS.Pan]: panValue >> 8 & 0xFF,
        [primaryMover.CHANNELS.PanFine]: panValue & 0xFF,
        [primaryMover.CHANNELS.Tilt]: tiltValue >> 8 & 0xFF,
        [primaryMover.CHANNELS.TiltFine]: tiltValue & 0xFF,
    });
    updateState();
};

joystick1.onData = () => {
    primaryMover.setChannels({
        [primaryMover.CHANNELS.Dimmer]: joystick1.throttle,
    });
};

const blockedChannels = new Set([
    ...Array.from({ length: 15 }, (_, i) => i + 1),   // ch 1–15  (joystick mover)
    ...Array.from({ length: 15 }, (_, i) => i + 16),  // ch 16–30 (gamepad mover)
]);

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
                if(msg.channel === primaryMover.channel || msg.channel === gamepadMover.channel) {
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
                    if(msg.values.Pan !== undefined || msg.values.PanFine !== undefined) {
                        const panCoarse = msg.values.Pan ?? (mover.channelValues.Pan ?? 0);
                        const panFine = msg.values.PanFine ?? (mover.channelValues.PanFine ?? 0);
                        joystick1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
                    }
                    if(msg.values.Tilt !== undefined || msg.values.TiltFine !== undefined) {
                        const tiltCoarse = msg.values.Tilt ?? (mover.channelValues.Tilt ?? 0);
                        const tiltFine = msg.values.TiltFine ?? (mover.channelValues.TiltFine ?? 0);
                        joystick1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
                    }
                }

                if(mover.channel === gamepadMover.channel) {
                    if(msg.values.Zoom !== undefined) gamepad1.zoom = msg.values.Zoom;
                    if(msg.values.Dimmer !== undefined) gamepad1.dimmer = msg.values.Dimmer;
                    if(msg.values.Pan !== undefined || msg.values.PanFine !== undefined) {
                        const panCoarse = msg.values.Pan ?? (mover.channelValues.Pan ?? 0);
                        const panFine = msg.values.PanFine ?? (mover.channelValues.PanFine ?? 0);
                        gamepad1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
                    }
                    if(msg.values.Tilt !== undefined || msg.values.TiltFine !== undefined) {
                        const tiltCoarse = msg.values.Tilt ?? (mover.channelValues.Tilt ?? 0);
                        const tiltFine = msg.values.TiltFine ?? (mover.channelValues.TiltFine ?? 0);
                        gamepad1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
                    }
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
