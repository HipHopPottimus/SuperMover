import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Client as OSCClient, Server as OSCServer } from "node-osc";

import path from 'path';
import * as fs from "fs";

import getDmx, { UNIVERSE_SIZE } from './dmx.js';

import mlib from './mover.js';
import jlib from "./joystick.js";
import glib from "./gamepad.js";
import { CUE_APPLY_GROUPS, CUE_FADE_GROUP_IDS, getFixtureProfile } from "../fixtures.js";

import * as util from "./util.js";

const dmx = getDmx();
const USE_FINE_CONTROL = process.env.DMX_DISABLE_FINE_PANTILT === "true" ? false : true;

const debug = process.env.debug === "true" || process.argv.includes("--debug");
const noisyWsLogging = process.argv.includes("--noisy-ws-logging");
if (debug) console.log("Debug mode is ON");
const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3000;

const server = createServer(app);
const wss = new WebSocketServer({ server });

function logSocketServerEvent(label, extra = {}) {
    if (!noisyWsLogging) return;
    console.log(`[ws] ${label}`, {
        time: new Date().toISOString(),
        clients: clients.length,
        ...extra,
    });
}

let movers = [new mlib.Mover(1, debug, '375z'), new mlib.Mover(16, debug, '375z')];
const primaryMover = movers[0];
const gamepadMover = movers[1];
syncConfiguredDmxChannels();
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
        [primaryMover.CHANNELS.Dimmer]: Math.round(joystick1.dimmer ?? joystick1.throttle ?? 0),
        ...encodePanTiltChannels(primaryMover, joystick1.x, joystick1.y),
    };
    applyMoverChannels(primaryMover, channels);
    updateState();
};

const blockedChannels = new Set([
    ...Array.from({ length: primaryMover.channelCount }, (_, i) => i + 1),
    ...Array.from({ length: gamepadMover.channelCount }, (_, i) => i + 16),
]);

let cueStorage = {};
let currentCueNumber = null;

let cueStorageFile = "cues.json";

const cueFileArgIndex = process.argv.indexOf("--cue-file");
if (cueFileArgIndex > 0 && process.argv[cueFileArgIndex + 1]) cueStorageFile = process.argv[cueFileArgIndex + 1];

if (process.argv.includes("--force-reset-cues") || !fs.existsSync(cueStorageFile)) {
    fs.writeFileSync(cueStorageFile, "{}");
    console.log("Reset cues file", cueStorageFile);
}

try {
    const cueStorageFileContents = fs.readFileSync(cueStorageFile, "utf8").trim();
    cueStorage = cueStorageFileContents ? JSON.parse(cueStorageFileContents) : {};
}
catch (e) {
    throw new Error("Error parsing cue file" + e);
}

if (!cueStorage.cues) cueStorage.cues = {};
if (!cueStorage.cueStack) cueStorage.cueStack = {};
if (!cueStorage.chases) cueStorage.chases = {};

const SPECIAL_CUE_STAGE = "SPC:STG";
const SPECIAL_CUE_RESET = "SPC:RST";
const SPECIAL_CUE_NAMES = [SPECIAL_CUE_STAGE, SPECIAL_CUE_RESET];

function getSpecialStageCue() {
    return {
        special: "stage",
        apply: getDefaultCueApplyState(),
    };
}

function normalizeSpecialCues() {
    if (!cueStorage.cues) cueStorage.cues = {};
    if (!cueStorage.cueStack) cueStorage.cueStack = {};
    if (!cueStorage.chases) cueStorage.chases = {};

    if (cueStorage.cues.RESET && !cueStorage.cues[SPECIAL_CUE_RESET]) {
        cueStorage.cues[SPECIAL_CUE_RESET] = cueStorage.cues.RESET;
    }

    delete cueStorage.cues.RESET;
    cueStorage.cues[SPECIAL_CUE_STAGE] = getSpecialStageCue();

    if (!cueStorage.cues[SPECIAL_CUE_RESET]) {
        cueStorage.cues[SPECIAL_CUE_RESET] = {
            Pan: 127,
            PanFine: 127,
            Tilt: 127,
            TiltFine: 127,
            PTSpeed: 0,
            ColorWheel: 0,
            GoboWheel: 0,
            GoboRotation: 0,
            Prism: 0,
            Focus: 0,
            Dimmer: 0,
            Shutter: 4,
            Function: 0,
            MovementMacros: 0,
            Zoom: 0,
            apply: getDefaultCueApplyState(),
        };
    }

    for (const cue of Object.values(cueStorage.cueStack)) {
        for (const [ch, cueRef] of Object.entries(cue?.movers || {})) {
            if (cueRef === "RESET") cue.movers[ch] = SPECIAL_CUE_RESET;
        }
    }

    for (const cue of Object.values(cueStorage.cueStack)) {
        for (const [ch, cueRef] of Object.entries(cue?.movers || {})) {
            if (isChaseRef(cueRef)) {
                if (!cueStorage.chases[cueRef.name]) continue;
            }
            else if (!cueStorage.cues[cueRef]) delete cue.movers[ch];
        }
    }

    const legacySequenceEntryProperty = "cha" + "seName";
    for (const [cueNumber, cue] of Object.entries(cueStorage.cueStack)) {
        if (cue?.[legacySequenceEntryProperty]) delete cueStorage.cueStack[cueNumber];
    }

    for (const [chaseName, chase] of Object.entries(cueStorage.chases)) {
        if (!util.isObject(chase)) {
            delete cueStorage.chases[chaseName];
            continue;
        }

        chase.loop = chase.loop !== false;
        chase.restartOnEnter = chase.restartOnEnter !== false;
        if (!Array.isArray(chase.steps)) chase.steps = [];
        chase.steps = chase.steps
            .filter(step => util.isObject(step) && step.cue !== SPECIAL_CUE_RESET)
            .map(step => ({
                cue: step.cue,
                name: typeof step.name === "string" ? step.name : undefined,
                values: util.isObject(step.values)
                    ? Object.fromEntries(Object.entries(step.values).filter(([key]) => CUE_APPLY_KEYS.has(key)))
                    : undefined,
                fadeTime: Math.max(0, Number.parseFloat(step.fadeTime) || 0),
                fadeTimes: util.isObject(step.fadeTimes)
                    ? Object.fromEntries(Object.entries(step.fadeTimes)
                        .filter(([groupId]) => CUE_FADE_GROUP_IDS.has(groupId))
                        .map(([groupId, value]) => [groupId, Math.max(0, Number.parseFloat(value) || 0)]))
                    : {},
                waitAfterFade: Math.max(0, Number.parseFloat(step.waitAfterFade) || 0),
            }));
    }

    const orderedCues = {};
    for (const cueName of SPECIAL_CUE_NAMES) orderedCues[cueName] = cueStorage.cues[cueName];
    for (const [cueName, cue] of Object.entries(cueStorage.cues)) {
        if (!SPECIAL_CUE_NAMES.includes(cueName)) orderedCues[cueName] = cue;
    }
    cueStorage.cues = orderedCues;
}

console.log("Loaded cue storage file", cueStorageFile);

function sendClientError(ws, message) {
    ws.send(JSON.stringify({
        type: 'ERROR',
        message
    }));
}

function getStoragePathParent(storage, propChain) {
    if (!Array.isArray(propChain)) return undefined;

    let parent = storage;
    for (const prop of propChain) {
        if ((!util.isObject(parent) && !Array.isArray(parent)) || !(prop in parent)) return undefined;
        parent = parent[prop];
    }

    return util.isObject(parent) || Array.isArray(parent) ? parent : undefined;
}

function parseDmxChannel(value) {
    const channel = Number.parseInt(value, 10);
    return Number.isInteger(channel) && channel >= 1 && channel <= UNIVERSE_SIZE ? channel : null;
}

function validateMoverAddress(startChannel, channelCount) {
    const channel = parseDmxChannel(startChannel);
    if (channel === null) return `Channel must be between 1 and ${UNIVERSE_SIZE}.`;
    if (channel + channelCount - 1 > UNIVERSE_SIZE) {
        return `Mover uses ${channelCount} channels, so start channel ${channel} exceeds DMX universe ${UNIVERSE_SIZE}.`;
    }
    return null;
}

app.get('/', (_req, res) => {
    const indexPath = path.resolve('public', 'index.html');
    const indexHtml = fs.readFileSync(indexPath, 'utf8');
    const injectedHtml = indexHtml.replace(
        '</head>',
        `    <script>window.__NOISY_WS_LOGGING__ = ${JSON.stringify(noisyWsLogging)};</script>\n</head>`
    );
    res.type('html').send(injectedHtml);
});

app.use(express.static(path.join('.', 'public')));
app.get('/fixtures.js', (_req, res) => res.sendFile(path.resolve('fixtures.js')));

function getDeleteTarget(storage, propChain, property) {
    const parent = getStoragePathParent(storage, propChain);
    if (parent) return parent;

    const reversedParent = getStoragePathParent(storage, [...propChain].reverse());
    if (reversedParent) return reversedParent;

    return undefined;
}

function isChaseRef(value) {
    return util.isObject(value) && value.type === "chase" && typeof value.name === "string";
}

function replaceStorageValue(storage, propChain, property, sourceStorage) {
    const targetParent = getStoragePathParent(storage, propChain);
    const sourceParent = getStoragePathParent(sourceStorage, propChain);

    if (!targetParent || !sourceParent || !(property in sourceParent)) return false;

    targetParent[property] = sourceParent[property];
    return true;
}

function saveCueStorage() {
    try {
        if (fs.existsSync(cueStorageFile) && fs.statSync(cueStorageFile).size > 0) {
            fs.copyFileSync(cueStorageFile, `${cueStorageFile}.bak`);
        }

        fs.writeFileSync(cueStorageFile, JSON.stringify(cueStorage, null, 2));
    }
    catch (e) {
        console.error("Error writing cue storage file", e);
    }
}

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

function syncConfiguredDmxChannels() {
    dmx.setConfiguredChannels(movers.flatMap(mover =>
        Array.from({ length: mover.channelCount }, (_, i) => mover.channel + i)
    ));
}

function normalizeMoverChannelsForMode(mover, channels) {
    if (USE_FINE_CONTROL) return channels;

    return {
        ...channels,
        [mover.CHANNELS.PanFine]: 0,
        [mover.CHANNELS.TiltFine]: 0,
    };
}

function moverSet(channel, values, options = {}) {
    const mover = movers.find(m => m.channel === channel);

    if (!mover) {
        throw new Error(`No mover at channel ${channel}`);
    }

    const sanitizedValues = {};
    for (const [channelName, value] of Object.entries(values || {})) {
        if (!(channelName in mover.CHANNELS)) {
            console.error(`Invalid channel name for mover at channel ${channel}: ${channelName} (v: ${value})`);
            continue;
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            throw new Error(`Invalid value for ${channelName}: ${value}`);
        }

        sanitizedValues[channelName] = numericValue;
    }

    if (!options.fromChase) stopChase(channel);

    if (mover.channel === primaryMover.channel) {
        if (sanitizedValues.Zoom !== undefined)
            joystick1.zoom = sanitizedValues.Zoom;
        if (sanitizedValues.Dimmer !== undefined)
            joystick1.dimmer = sanitizedValues.Dimmer;
        if (sanitizedValues.Pan !== undefined || sanitizedValues.PanFine !== undefined) {
            const panCoarse = sanitizedValues.Pan ?? (mover.channelValues.Pan ?? 0);
            const panFine = USE_FINE_CONTROL ? (sanitizedValues.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
            joystick1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
        }
        if (sanitizedValues.Tilt !== undefined || sanitizedValues.TiltFine !== undefined) {
            const tiltCoarse = sanitizedValues.Tilt ?? (mover.channelValues.Tilt ?? 0);
            const tiltFine = USE_FINE_CONTROL ? (sanitizedValues.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
            joystick1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
        }
    }

    if (mover.channel === gamepadMover.channel) {
        if (sanitizedValues.Zoom !== undefined) gamepad1.zoom = sanitizedValues.Zoom;
        if (sanitizedValues.Dimmer !== undefined) gamepad1.dimmer = sanitizedValues.Dimmer;
        if (sanitizedValues.Pan !== undefined || sanitizedValues.PanFine !== undefined) {
            const panCoarse = sanitizedValues.Pan ?? (mover.channelValues.Pan ?? 0);
            const panFine = USE_FINE_CONTROL ? (sanitizedValues.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
            gamepad1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
        }
        if (sanitizedValues.Tilt !== undefined || sanitizedValues.TiltFine !== undefined) {
            const tiltCoarse = sanitizedValues.Tilt ?? (mover.channelValues.Tilt ?? 0);
            const tiltFine = USE_FINE_CONTROL ? (sanitizedValues.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
            gamepad1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
        }
    }

    const translatedValues = Object.fromEntries(
        Object.entries(sanitizedValues).map(([channelName, value]) => [mover.CHANNELS[channelName], value])
    );
    applyMoverChannels(mover, translatedValues);
    updateState();
}

function resetAllMovers() {
    stopCueTweens();
    stopChasesExcept();

    const resetCueStackEntry = {
        ...(currentCueNumber === null ? {} : cueStorage.cueStack[currentCueNumber]),
        movers: Object.fromEntries(movers.map(mover => [mover.channel, SPECIAL_CUE_RESET])),
    };

    for (const mover of movers) {
        applyCueValuesToMover(mover.channel, mover.getResetValues(), resetCueStackEntry);
    }

    currentCueNumber = null;
    sendToAllClients({ type: "CUE_STATE", cueNumber: currentCueNumber });
    updateState();
}

function blackoutAllMovers() {
    stopCueTweens();

    for (const mover of movers) moverSet(mover.channel, { Dimmer: 0 });
}

function syncControlSurfaceFromMover(mover) {
    const values = mover.channelValues;

    if (mover.channel === primaryMover.channel) {
        joystick1.zoom = values.Zoom;
        joystick1.dimmer = values.Dimmer;
        joystick1.x = (((values.Pan ?? 0) << 8) | (USE_FINE_CONTROL ? (values.PanFine ?? 0) : 0)) / 65535 * 255;
        joystick1.y = (((values.Tilt ?? 0) << 8) | (USE_FINE_CONTROL ? (values.TiltFine ?? 0) : 0)) / 65535 * 255;
    }

    if (mover.channel === gamepadMover.channel) {
        gamepad1.zoom = values.Zoom;
        gamepad1.dimmer = values.Dimmer;
        gamepad1.x = (((values.Pan ?? 0) << 8) | (USE_FINE_CONTROL ? (values.PanFine ?? 0) : 0)) / 65535 * 255;
        gamepad1.y = (((values.Tilt ?? 0) << 8) | (USE_FINE_CONTROL ? (values.TiltFine ?? 0) : 0)) / 65535 * 255;
    }
}

function sendToAllClients(message) {
    const stringifiedMessage = JSON.stringify(message);
    // logSocketServerEvent("broadcast", {
    //     type: message?.type,
    //     recipients: clients.filter(client => client.readyState === WebSocket.OPEN).length,
    //     size: stringifiedMessage.length,
    // });
    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(stringifiedMessage);
        }
    }
}

function updateState() {
    const state = getState();
    sendToAllClients({ type: 'STATE', state });
}

function sendCueState(ws) {
    logSocketServerEvent("send cue state", {
        cueNumber: currentCueNumber,
    });
    ws.send(JSON.stringify({
        type: 'CUE_STATE',
        cueNumber: currentCueNumber,
    }));
}

const clients = [];

function isChannelBlocked(channel) {
    return blockedChannels.has(channel);
}

function getMoverChannelRange(startChannel, count) {
    return Array.from({ length: count }, (_, i) => startChannel + i);
}

function getMoverCreateError(startChannel, count) {
    if (!Number.isInteger(startChannel) || startChannel < 1) return 'Mover start channel must be 1 or greater.';
    if (startChannel + count - 1 > UNIVERSE_SIZE) return `Mover range ${startChannel}-${startChannel + count - 1} exceeds DMX channel ${UNIVERSE_SIZE}.`;

    const blockedChannel = getMoverChannelRange(startChannel, count).find(isChannelBlocked);
    if (blockedChannel !== undefined) {
        return `Channel ${blockedChannel} is already in use by another mover. Please choose a different channel.`;
    }

    return null;
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
    const req = ws._socket?.parser?.incoming || ws.upgradeReq;
    const remoteAddress = ws._socket?.remoteAddress;
    const remotePort = ws._socket?.remotePort;
    if (noisyWsLogging) {
        console.log('[ws] client connected', {
            time: new Date().toISOString(),
            remoteAddress,
            remotePort,
            url: req?.url,
            userAgent: req?.headers?.['user-agent'],
        });
    }

    clients.push(ws);

    logSocketServerEvent("initial state push", { remoteAddress, remotePort });
    ws.send(JSON.stringify({
        type: 'STATE',
        state: getState(),
    }));

    ws.send(JSON.stringify({
        type: 'CUE_STORAGE_STATE',
        cueStorage,
    }));

    sendCueState(ws);

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

        logSocketServerEvent("message received", {
            remoteAddress,
            remotePort,
            type: msg?.type,
            size: message.length ?? message.toString().length,
        });
        if (debug) console.log(msg);

        switch (msg.type) {
            case 'CREATE_MOVER': {
                const fixtureType = msg.fixtureType || '375z';
                const channelCount = getFixtureProfile(fixtureType).channelCount;
                const validatedChannel = parseDmxChannel(msg.channel);
                const validationError = validateMoverAddress(msg.channel, channelCount);

                if (validationError) {
                    sendClientError(ws, validationError);
                    return;
                }

                const occupancyError = getMoverCreateError(validatedChannel, channelCount);
                if (occupancyError) {
                    sendClientError(ws, occupancyError);
                    return;
                }

                const newMover = new mlib.Mover(validatedChannel, debug, fixtureType);
                blockMoverChannels(validatedChannel, newMover.channelCount);
                movers.push(newMover);
                syncConfiguredDmxChannels();
                applyMoverChannels(newMover, Object.fromEntries(
                    Object.entries(newMover.channelValues).filter(([channel]) => /^\d+$/.test(channel))
                ));
                updateState();
                break;
            }
            case 'FORGET_MOVER': {
                const channel = parseDmxChannel(msg.channel);
                if (channel === null) {
                    sendClientError(ws, `Channel must be between 1 and ${UNIVERSE_SIZE}.`);
                    return;
                }
                if (channel === primaryMover.channel || channel === gamepadMover.channel) {
                    sendClientError(ws, 'Cannot forget the primary mover!');
                    return;
                }
                const forgetMover = movers.find(m => m.channel === channel);
                if (!forgetMover) {
                    sendClientError(ws, `No mover at channel ${msg.channel}`);
                    return;
                }
                stopChase(channel);
                movers = movers.filter(m => m.channel !== channel);
                for (let dmxChannel = channel; dmxChannel < channel + forgetMover.channelCount; dmxChannel++)
                    blockedChannels.delete(dmxChannel);
                syncConfiguredDmxChannels();
                updateState();
                break;
            }
            case 'MOVER_SET': {
                const channel = parseDmxChannel(msg.channel);
                if (channel === null) {
                    sendClientError(ws, `Channel must be between 1 and ${UNIVERSE_SIZE}.`);
                    return;
                }
                try {
                    moverSet(channel, msg.values);
                }
                catch (e) {
                    sendClientError(ws, e.message || String(e));
                }
                break;
            }
            case 'START_CHASE': {
                const channel = Number.parseInt(msg.channel);
                if (!movers.some(m => m.channel === channel)) {
                    sendClientError(ws, `No mover at channel ${msg.channel}`);
                    return;
                }
                if (!cueStorage.chases[msg.chaseName]) {
                    sendClientError(ws, `Invalid chase ${msg.chaseName}`);
                    return;
                }
                startChaseForMover(channel, msg.chaseName);
                break;
            }
            case 'GET_STATE': {
                ws.send(JSON.stringify({
                    type: 'STATE',
                    state: getState(),
                }));
                ws.send(JSON.stringify({
                    type: 'CUE_STORAGE_STATE',
                    cueStorage,
                }));
                sendCueState(ws);
                break;
            }
            case "GOTO_CUE_NUMBER": {
                if (isNaN(msg.cueNumber) || !cueStorage.cueStack[msg.cueNumber]) {
                    ws.send(JSON.stringify({
                        type: 'ERROR',
                        message: `Invalid cue number ${msg.cueNumber}`
                    }));
                    return;
                }
                goToCueNumber(msg.cueNumber);
                break;
            }
            case "CLEAR_CUE": {
                clearCurrentCue();
                break;
            }
            case "RESET_ALL": {
                resetAllMovers();
                break;
            }
            case "BLACKOUT_ALL": {
                blackoutAllMovers();
                break;
            }
            case 'CUE_STORAGE_UPDATE': {
                if (!msg.change || !msg.cueStorage) {
                    sendClientError(ws, "Invalid cue storage update");
                    return;
                }

                const specialCues = Object.fromEntries(SPECIAL_CUE_NAMES
                    .filter(cueName => cueStorage.cues[cueName])
                    .map(cueName => [cueName, cueStorage.cues[cueName]]));

                if (msg.change.type == "delete") {
                    if (msg.change.propChain?.[0] === "cues" && SPECIAL_CUE_NAMES.includes(msg.change.property)) {
                        sendClientError(ws, `Cannot delete special cue ${msg.change.property}`);
                        return;
                    }

                    const valueToDelete = getDeleteTarget(cueStorage, msg.change.propChain, msg.change.property);
                    if (!valueToDelete) {
                        sendClientError(ws, `Invalid cue storage delete path: ${(msg.change.propChain || []).join(".")}.${msg.change.property}`);
                        return;
                    }

                    delete valueToDelete[msg.change.property];
                }
                else if (msg.change.type == "replace") {
                    if (Array.isArray(msg.change.propChain) && msg.change.propChain.length) {
                        if (!replaceStorageValue(cueStorage, msg.change.propChain, msg.change.property, msg.cueStorage)) {
                            sendClientError(ws, `Invalid cue storage replace path: ${msg.change.propChain.join(".")}.${msg.change.property}`);
                            return;
                        }
                    }
                    else {
                        cueStorage[msg.change.property] = msg.cueStorage[msg.change.property];
                    }
                }
                else {
                    cueStorage = util.deepMerge(cueStorage, msg.cueStorage);
                }

                normalizeSpecialCues();
                cueStorage.cues = {
                    ...cueStorage.cues,
                    ...specialCues,
                    [SPECIAL_CUE_STAGE]: getSpecialStageCue(),
                };
                normalizeSpecialCues();
                if (currentCueNumber && !cueStorage.cueStack[currentCueNumber]) {
                    currentCueNumber = null;
                }

                sendToAllClients({
                    type: 'CUE_STORAGE_STATE',
                    cueStorage
                });
                sendToAllClients({ type: "CUE_STATE", cueNumber: currentCueNumber });
                saveCueStorage();
                break;
            }
            default: {
                console.log("Received unknown message: ", msg);
            }
        }
    });

    ws.on('error', error => {
        if (!noisyWsLogging) return;
        console.error('[ws] client socket error', {
            time: new Date().toISOString(),
            remoteAddress,
            remotePort,
            error,
        });
    });

    ws.on('close', (code, reasonBuffer) => {
        const reason = reasonBuffer?.toString?.() || "";
        if (noisyWsLogging) {
            console.log('[ws] client disconnected', {
                time: new Date().toISOString(),
                remoteAddress,
                remotePort,
                code,
                reason,
            });
        }
        const index = clients.indexOf(ws);
        if (index !== -1) {
            clients.splice(index, 1);
        }
        logSocketServerEvent("client removed", { remoteAddress, remotePort });
    });
});

const CUE_APPLY_KEYS = new Map(CUE_APPLY_GROUPS.flatMap(group => group.keys.map(key => [key, group.id])));
const TWEENABLE_ATTRIBUTES = CUE_APPLY_GROUPS
    .filter(group => CUE_FADE_GROUP_IDS.has(group.id))
    .flatMap(group => group.keys);

normalizeSpecialCues();

function getCueValues(cueName) {
    const cue = cueStorage.cues[cueName];
    if (!cue) return {};

    const applyState = getCueApplyState(cue);
    return Object.fromEntries(Object.entries(cue).filter(([key]) => {
        const group = CUE_APPLY_KEYS.get(key);
        return group && applyState[group];
    }));
}

function getChaseStepValues(chaseName, stepIndex, stageDepth = 0) {
    const chase = cueStorage.chases[chaseName];
    const steps = chase?.steps || [];
    if (!steps.length || stageDepth >= steps.length) return null;

    const step = steps[stepIndex % steps.length];
    if (step?.values && typeof step.values === "object") {
        return Object.fromEntries(Object.entries(step.values).filter(([key]) => CUE_APPLY_KEYS.has(key)));
    }

    if (!step?.cue || step.cue === SPECIAL_CUE_RESET || !cueStorage.cues[step.cue]) return null;
    if (step.cue === SPECIAL_CUE_STAGE) {
        const nextStepIndex = stepIndex + 1;
        const nextStepValues = (chase.loop !== false || nextStepIndex < steps.length)
            ? (getChaseStepValues(chaseName, nextStepIndex, stageDepth + 1) || {})
            : {};
        return {
            ...nextStepValues,
            Dimmer: 0,
        };
    }

    return getCueValues(step.cue);
}

function getCueValuesForCueRef(cueRef) {
    if (isChaseRef(cueRef)) return getChaseStepValues(cueRef.name, 0) || {};
    return getCueValues(cueRef);
}

function getDefaultCueApplyState() {
    return Object.fromEntries(CUE_APPLY_GROUPS.map(group => [group.id, group.defaultOn]));
}

function getCueApplyState(cue) {
    if (cue?.apply) return { ...getDefaultCueApplyState(), ...cue.apply };

    const applyState = getDefaultCueApplyState();
    if (cue?.mode === "pos") {
        for (const group of CUE_APPLY_GROUPS) applyState[group.id] = group.id === "POS";
    }
    else if (cue?.mode === "no-pos") {
        applyState.POS = false;
    }
    return applyState;
}

let activeCueTweens = [];
const activeChases = new Map();
const MIN_CHASE_STEP_MS = 50;

function stopCueTweens() {
    activeCueTweens.forEach(tId => clearInterval(tId));
    activeCueTweens = [];
}

function stopChase(ch) {
    const channel = Number.parseInt(ch);
    const active = activeChases.get(channel);
    if (!active) return;

    active.timers.forEach(timerId => clearTimeout(timerId));
    active.tweens.forEach(timerId => clearInterval(timerId));
    activeChases.delete(channel);
}

function stopChasesExcept(assignmentsToKeep = new Map()) {
    for (const [ch, active] of [...activeChases.entries()]) {
        if (assignmentsToKeep.get(ch) === active.name) continue;
        stopChase(ch);
    }
}

function getCueFadeTime(cue, attribute) {
    // if (cue?.special === "stage") return 0;

    const groupId = CUE_APPLY_KEYS.get(attribute);
    const groupFade = Number.parseFloat(cue?.fadeTimes?.[groupId]);
    if (!Number.isNaN(groupFade)) return groupFade;

    const defaultFade = Number.parseFloat(cue?.fadeTime);
    return Number.isNaN(defaultFade) ? 0 : defaultFade;
}

function getCueNumberList() {
    return Object.keys(cueStorage.cueStack).map(parseFloat).sort((a, b) => a - b).map(x => x.toString());
}

function getNextCueRefForMover(cueNumber, ch) {
    const cueNumberList = getCueNumberList();
    const cueIndex = cueNumberList.indexOf(cueNumber.toString());
    if (cueIndex === -1) return undefined;

    for (const nextCueNumber of cueNumberList.slice(cueIndex + 1)) {
        const nextCueRef = cueStorage.cueStack[nextCueNumber]?.movers?.[ch];
        if (nextCueRef && nextCueRef !== SPECIAL_CUE_STAGE) return nextCueRef;
    }

    return undefined;
}

function getCueDelayTime(cue, attribute) {
    const groupId = CUE_APPLY_KEYS.get(attribute);
    const groupDelay = Number.parseFloat(cue?.delayTimes?.[groupId]);
    if (!Number.isNaN(groupDelay)) return groupDelay;

    const defaultDelay = Number.parseFloat(cue?.delayTime);
    return Number.isNaN(defaultDelay) ? 0 : defaultDelay;
}

function getCueValuesForStackEntry(cueNumber, ch, cueRef) {
    if (cueRef !== SPECIAL_CUE_STAGE) return getCueValuesForCueRef(cueRef);

    const nextCueRef = getNextCueRefForMover(cueNumber, ch);
    const nextCueValues = nextCueRef && nextCueRef !== SPECIAL_CUE_STAGE ? getCueValuesForCueRef(nextCueRef) : {};
    return {
        ...nextCueValues,
        Dimmer: 0,
    };
}

function getCueStackEntryForPlayback(cueStackEntry, stepOptions = {}) {
    return {
        ...cueStackEntry,
        fadeTime: stepOptions.fadeTime ?? cueStackEntry.fadeTime,
        delayTime: stepOptions.delayTime ?? cueStackEntry.delayTime,
        fadeTimes: stepOptions.fadeTime === undefined ? cueStackEntry.fadeTimes : {},
        delayTimes: stepOptions.delayTime === undefined ? cueStackEntry.delayTimes : {},
    };
}

function getCueStackEntryForMoverPlayback(cueRef, cueStackEntry) {
    return cueStackEntry;
}

function isBlackoutThenApplyCueRef(cueRef) {
    return cueRef === SPECIAL_CUE_STAGE || cueRef === SPECIAL_CUE_RESET;
}

function getDimmerPlaybackDuration(cueStackEntry) {
    return getCueDelayTime(cueStackEntry, "Dimmer") + getCueFadeTime(cueStackEntry, "Dimmer");
}

function getInstantCueStackEntry(cueStackEntry) {
    return {
        ...cueStackEntry,
        fadeTime: 0,
        delayTime: 0,
        fadeTimes: {},
        delayTimes: {},
    };
}

function getCuePlaybackDurationForValues(cueToSet, cueStackEntry) {
    return TWEENABLE_ATTRIBUTES.reduce((duration, attribute) => {
        if (cueToSet[attribute] === undefined) return duration;
        return Math.max(
            duration,
            getCueDelayTime(cueStackEntry, attribute) + getCueFadeTime(cueStackEntry, attribute)
        );
    }, 0);
}

function getCuePlaybackDuration(cueNumber, ch, cueRef, cueStackEntry) {
    if (isBlackoutThenApplyCueRef(cueRef)) return getDimmerPlaybackDuration(cueStackEntry);

    return getCuePlaybackDurationForValues(
        getCueValuesForStackEntry(cueNumber, ch, cueRef),
        getCueStackEntryForMoverPlayback(cueRef, cueStackEntry)
    );
}

function applyCueValuesToMover(ch, cueToSet, cueStackEntry, options = {}) {
    const mover = movers.find(m => m.channel == ch);
    if (!mover) return;
    const cueValuesForMover = Object.fromEntries(
        Object.entries(cueToSet || {}).filter(([attribute]) => attribute in mover.CHANNELS)
    );

    const nonTweenableData = { ...cueValuesForMover };
    TWEENABLE_ATTRIBUTES.forEach(a => delete nonTweenableData[a]);
    moverSet(ch, nonTweenableData, options);

    const tweenIds = [];
    for (const attribute of TWEENABLE_ATTRIBUTES) {
        const initialValue = mover.channelValues[attribute];
        const targetValue = cueValuesForMover[attribute];
        if (targetValue === undefined) continue;

        const fadeTime = getCueFadeTime(cueStackEntry, attribute) * 1000;
        const delayTime = getCueDelayTime(cueStackEntry, attribute) * 1000;
        if (fadeTime <= 0 || initialValue === undefined) {
            if (delayTime > 0) {
                const timeoutId = setTimeout(() => {
                    if (movers.some(m => m.channel == ch)) moverSet(ch, { [attribute]: targetValue }, options);
                }, delayTime);
                tweenIds.push(timeoutId);
            }
            else {
                moverSet(ch, { [attribute]: targetValue }, options);
            }
            continue;
        }

        let value = initialValue;
        const startTime = performance.now() + delayTime;
        const intervalId = setInterval(() => {
            if (!movers.some(m => m.channel == ch)) {
                clearInterval(intervalId);
                return;
            }
            const elapsedTime = performance.now() - startTime;
            if (elapsedTime < 0) return;
            value = Math.floor(initialValue + (targetValue - initialValue) * (elapsedTime / fadeTime));
            if (elapsedTime >= fadeTime) {
                value = targetValue;
                clearInterval(intervalId);
            }
            moverSet(ch, { [attribute]: value }, options);
        }, 16.7);

        tweenIds.push(intervalId);
    }

    if (options.collectTweens) options.collectTweens(tweenIds);
    else activeCueTweens.push(...tweenIds);
}

function applyBlackoutThenApplyValuesToMover(ch, cueValues, cueStackEntry, options = {}) {
    const dimmerOnlyValues = cueValues.Dimmer === undefined ? {} : { Dimmer: cueValues.Dimmer };
    const remainingValues = { ...cueValues };
    delete remainingValues.Dimmer;

    applyCueValuesToMover(ch, dimmerOnlyValues, cueStackEntry, options);
    if (!Object.keys(remainingValues).length) return;

    const applyRemaining = () => {
        if (!movers.some(m => m.channel == ch)) return;
        applyCueValuesToMover(ch, remainingValues, getInstantCueStackEntry(cueStackEntry), options);
    };
    const dimmerDurationMs = getDimmerPlaybackDuration(cueStackEntry) * 1000;
    if (dimmerDurationMs <= 0) {
        applyRemaining();
        return;
    }

    const timeoutId = setTimeout(applyRemaining, dimmerDurationMs);
    if (options.collectTweens) options.collectTweens([timeoutId]);
    else activeCueTweens.push(timeoutId);
}

function applyCueRefToMover(ch, cueNumber, cueRef, cueStackEntry, options = {}) {
    const cueValues = getCueValuesForStackEntry(cueNumber, ch, cueRef);
    if (isBlackoutThenApplyCueRef(cueRef)) {
        applyBlackoutThenApplyValuesToMover(ch, cueValues, cueStackEntry, options);
        return;
    }

    applyCueValuesToMover(ch, cueValues, cueStackEntry, options);
}

function startChaseForMover(ch, chaseName) {
    const chase = cueStorage.chases[chaseName];
    if (!chase?.steps?.length) return;

    stopChase(ch);
    const active = { name: chaseName, timers: [], tweens: [] };
    activeChases.set(ch, active);

    const runStep = stepIndex => {
        if (activeChases.get(ch) !== active) return;

        active.tweens.forEach(timerId => clearInterval(timerId));
        active.tweens = [];
        const currentChase = cueStorage.chases[chaseName];
        const steps = currentChase?.steps || [];
        if (!steps.length) {
            stopChase(ch);
            return;
        }

        const step = steps[stepIndex % steps.length];
        const stepValues = getChaseStepValues(chaseName, stepIndex);
        if (!stepValues) {
            const timerId = setTimeout(() => runStep(stepIndex + 1), MIN_CHASE_STEP_MS);
            active.timers.push(timerId);
            return;
        }

        const fallbackFadeTime = Math.max(0, Number.parseFloat(step.fadeTime) || 0);
        const waitAfterFade = Math.max(0, Number.parseFloat(step.waitAfterFade) || 0);
        const chaseStepStackEntry = getCueStackEntryForPlayback({
            fadeTime: fallbackFadeTime,
            fadeTimes: step.fadeTimes || {},
            movers: { [ch]: step.name || step.cue || "" },
        });

        const stepOptionsForApply = {
            fromChase: true,
            collectTweens: tweenIds => active.tweens.push(...tweenIds),
        };
        if (isBlackoutThenApplyCueRef(step.cue)) {
            applyBlackoutThenApplyValuesToMover(ch, stepValues, chaseStepStackEntry, stepOptionsForApply);
        }
        else {
            applyCueValuesToMover(ch, stepValues, chaseStepStackEntry, stepOptionsForApply);
        }

        const nextStep = stepIndex + 1;
        if (currentChase.loop !== false || nextStep < steps.length) {
            const stepDuration = isBlackoutThenApplyCueRef(step.cue)
                ? getDimmerPlaybackDuration(chaseStepStackEntry)
                : getCuePlaybackDurationForValues(stepValues, chaseStepStackEntry);
            const timerId = setTimeout(() => runStep(nextStep), Math.max(MIN_CHASE_STEP_MS, (stepDuration + waitAfterFade) * 1000));
            active.timers.push(timerId);
        }
    };

    runStep(0);
}

function goToCueNumber(cueNumber, stepOptions = {}) {
    currentCueNumber = cueNumber.toString();
    sendToAllClients({ type: "CUE_STATE", cueNumber: currentCueNumber });

    stopCueTweens();
    const playbackCueStackEntry = getCueStackEntryForPlayback(cueStorage.cueStack[cueNumber], stepOptions);
    const chasesToKeep = new Map();
    for (const [chText, cueRef] of Object.entries(cueStorage.cueStack[cueNumber].movers)) {
        if (isChaseRef(cueRef)) chasesToKeep.set(Number.parseInt(chText), cueRef.name);
    }
    stopChasesExcept(chasesToKeep);

    for (let [ch, cueRef] of Object.entries(cueStorage.cueStack[cueNumber].movers)) {
        ch = Number.parseInt(ch);

        if (isChaseRef(cueRef)) {
            const active = activeChases.get(ch);
            if (active?.name === cueRef.name) continue;
            startChaseForMover(ch, cueRef.name);
            continue;
        }

        const cueStackEntry = getCueStackEntryForMoverPlayback(cueRef, playbackCueStackEntry);
        applyCueRefToMover(ch, cueNumber, cueRef, cueStackEntry);
    }
}

function clearCurrentCue() {
    currentCueNumber = null;
    stopCueTweens();
    stopChasesExcept();
    sendToAllClients({ type: "CUE_STATE", cueNumber: currentCueNumber });
}

const oscClient = new OSCClient("192.168.200.1", 8000);
if (process.argv.includes("--use-quickq-feedback"))
    oscClient.send("/feedback/pb+exec");

const oscServer = new OSCServer(8001, "0.0.0.0");
oscServer.on("message", msg => {
    if (debug) console.log("RECEIVED OSC", msg);
    const path = msg[0].split("/");
    const [_, cmd, pb, cueNumber] = path;

    if (cmd != "pb" || !cueNumber || !cueStorage.cueStack[cueNumber]) return;

    goToCueNumber(cueNumber);


    if (process.argv.includes("--use-quickq-feedback") && pb == 1) {
        const intensity = msg[1];
        console.log(pb, msg[1]);
        let data = {};
        let channelsToSet = [1, 2, 3, 4, 5];
        channelsToSet.forEach(c => data[c] = intensity);
        getDmx().setChannels(data);
        return;
    }
});

server.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
});
