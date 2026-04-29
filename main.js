import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Client as OSCClient, Server as OSCServer } from "node-osc";
import path from 'path';

import getDmx from './dmx.js';

import mlib from './mover.js';
import jlib from "./joystick.js";
import glib from "./gamepad.js";

const dmx = getDmx();
const USE_FINE_CONTROL = process.env.DMX_DISABLE_FINE_PANTILT === "true" ? false : true;

const debug = process.env.debug === "true" || process.argv.includes("--debug");
if (debug) console.log("Debug mode is ON");
const app = express();
const port = 3000;

app.use(express.static(path.join('.', 'public')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

let movers = [new mlib.Mover(1, debug, '375z'), new mlib.Mover(16, debug, '375z')];
const primaryMover = movers[0];
const gamepadMover = movers[1];
syncAllMoversToUniverse();
dmx.start();

let joystick1 = { onUpdate() { } };

try {
    joystick1 = new jlib.Joystick(0x046d, 0xc214);
    console.log("Joystick initialized");
} catch {
    console.log("No joystick found");
}

let gamepad1 = { onUpdate() { } };

try {
    gamepad1 = new glib.Gamepad(0);
    console.log("Gamepad initialized on controller index 0");
} catch {
    console.log("No gamepad found");
}

gamepad1.onUpdate = () => {
    const channels = {
        [gamepadMover.CHANNELS.Zoom]: Math.round(gamepad1.zoom),
        [gamepadMover.CHANNELS.Dimmer]: Math.round(gamepad1.dimmer),
        ...encodePanTiltChannels(gamepadMover, gamepad1.x, gamepad1.y),
    };
    applyMoverChannels(gamepadMover, channels);
    updateState();
};

joystick1.onUpdate = () => {
    const channels = {
        [primaryMover.CHANNELS.Zoom]: Math.round(joystick1.zoom),
        [primaryMover.CHANNELS.Dimmer]: joystick1.throttle,
        ...encodePanTiltChannels(primaryMover, joystick1.x, joystick1.y),
    };
    applyMoverChannels(primaryMover, channels);
    updateState();
};

const blockedChannels = new Set([
    ...Array.from({ length: primaryMover.channelCount }, (_, i) => i + 1),
    ...Array.from({ length: gamepadMover.channelCount }, (_, i) => i + 16),
]);

function getState() {
    return {
        movers,
        dmx: debug ? dmx.getStats() : undefined,
        useFineControl: USE_FINE_CONTROL,
    };
}

function encodePanTiltChannels(mover, x, y) {
    const panValue = Math.round(x / 255 * 65535);
    const tiltValue = Math.round(y / 255 * 65535);
    const channels = {
        [mover.CHANNELS.Pan]: panValue >> 8 & 0xFF,
        [mover.CHANNELS.Tilt]: tiltValue >> 8 & 0xFF,
    };

    if (USE_FINE_CONTROL) {
        channels[mover.CHANNELS.PanFine] = panValue & 0xFF;
        channels[mover.CHANNELS.TiltFine] = tiltValue & 0xFF;
    } else {
        channels[mover.CHANNELS.PanFine] = 0;
        channels[mover.CHANNELS.TiltFine] = 0;
    }

    return channels;
}

function applyMoverChannels(mover, channels) {
    const normalizedChannels = normalizeMoverChannelsForMode(mover, channels);
    mover.setChannels(normalizedChannels);
    dmx.setChannels(normalizedChannels);
}

function syncAllMoversToUniverse() {
    for (const mover of movers) {
        const numericChannels = {};
        for (const [channel, value] of Object.entries(mover.channelValues)) {
            if (/^\d+$/.test(channel)) numericChannels[channel] = value;
        }
        dmx.setChannels(normalizeMoverChannelsForMode(mover, numericChannels));
    }
}

function normalizeMoverChannelsForMode(mover, channels) {
    if (USE_FINE_CONTROL) return channels;

    return {
        ...channels,
        [mover.CHANNELS.PanFine]: 0,
        [mover.CHANNELS.TiltFine]: 0,
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

function blockMoverChannels(startChannel, count) {
    for (let channel = startChannel; channel < startChannel + (count || 15); channel++) {
        blockedChannels.add(channel);
    }
}

export function sendError(message) {
    clients.forEach(v => v.send(JSON.stringify({
        type: "ERROR",
        message
    })));
}

wss.on('connection', (ws) => {
    console.log('Client connected!');

    clients.push(ws);

    const oscClient = new OSCClient("192.168.200.1", 8000);
    oscClient.send("/feedback/pb+exec");

    const oscServer = new OSCServer(8000, "0.0.0.0");
    oscServer.on("message", msg => {

        const path = msg[0].split("/");
        const [_, cmd, pb, cueNumber] = path;

        if (cmd != "pb") return;

        if (cueNumber) {
            ws.send(JSON.stringify({ type: "OSC", cueNumber: cueNumber }));
            return;
        }

        if (process.argv.includes("--use-quickq-feedback") && pb == 1) {
            const intensity = msg[1];
            let data = {};
            let channelsToSet = [1, 2, 3, 4, 5];
            channelsToSet.forEach(c => data[c] = intensity);
            dmx.setChannels(data);
            return;
        }
    });

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

                const fixtureType = msg.fixtureType || '375z';
                const newMover = new mlib.Mover(msg.channel, debug, fixtureType);
                blockMoverChannels(msg.channel, newMover.channelCount);
                movers.push(newMover);
                applyMoverChannels(newMover, Object.fromEntries(
                    Object.entries(newMover.channelValues).filter(([channel]) => /^\d+$/.test(channel))
                ));
                updateState();
                break;
            }
            case 'FORGET_MOVER': {
                if (msg.channel === primaryMover.channel || msg.channel === gamepadMover.channel) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: 'Cannot forget the primary mover!' }));
                    return;
                }
                const forgetMover = movers.find(m => m.channel == msg.channel);
                const forgetCount = forgetMover ? forgetMover.channelCount : 15;
                movers = movers.filter(m => m.channel != msg.channel);
                for (let channel = msg.channel; channel < msg.channel + forgetCount; channel++)
                    blockedChannels.delete(channel);
                break;
            }
            case 'MOVER_SET': {
                const mover = movers.find(m => m.channel === msg.channel);
                if (!mover) {
                    ws.send(JSON.stringify({ type: 'ERROR', message: `No mover at channel ${msg.channel}` }));
                    return;
                }

                if (mover.channel === primaryMover.channel) {
                    if (msg.values.Zoom !== undefined)
                        joystick1.zoom = msg.values.Zoom;
                    if (msg.values.Pan !== undefined || msg.values.PanFine !== undefined) {
                        const panCoarse = msg.values.Pan ?? (mover.channelValues.Pan ?? 0);
                        const panFine = USE_FINE_CONTROL ? (msg.values.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
                        joystick1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
                    }
                    if (msg.values.Tilt !== undefined || msg.values.TiltFine !== undefined) {
                        const tiltCoarse = msg.values.Tilt ?? (mover.channelValues.Tilt ?? 0);
                        const tiltFine = USE_FINE_CONTROL ? (msg.values.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
                        joystick1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
                    }
                }

                if (mover.channel === gamepadMover.channel) {
                    if (msg.values.Zoom !== undefined) gamepad1.zoom = msg.values.Zoom;
                    if (msg.values.Dimmer !== undefined) gamepad1.dimmer = msg.values.Dimmer;
                    if (msg.values.Pan !== undefined || msg.values.PanFine !== undefined) {
                        const panCoarse = msg.values.Pan ?? (mover.channelValues.Pan ?? 0);
                        const panFine = USE_FINE_CONTROL ? (msg.values.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
                        gamepad1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
                    }
                    if (msg.values.Tilt !== undefined || msg.values.TiltFine !== undefined) {
                        const tiltCoarse = msg.values.Tilt ?? (mover.channelValues.Tilt ?? 0);
                        const tiltFine = USE_FINE_CONTROL ? (msg.values.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
                        gamepad1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
                    }
                }

                const translatedValues = Object.fromEntries(
                    Object.entries(msg.values).map(([channelName, value]) => [mover.CHANNELS[channelName], value])
                );
                applyMoverChannels(mover, translatedValues);
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
