import express from 'express';
import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Client as OSCClient, Server as OSCServer } from "node-osc";

import path from 'path';
import * as fs from "fs";

import getDmx from './dmx.js';

import mlib from './mover.js';
import jlib from "./joystick.js";
import glib from "./gamepad.js";

import * as util from "./util.js";

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
        for (const [ch, cueName] of Object.entries(cue?.movers || {})) {
            if (cueName === "RESET") cue.movers[ch] = SPECIAL_CUE_RESET;
        }
    }

    for (const cue of Object.values(cueStorage.cueStack)) {
        for (const [ch, cueName] of Object.entries(cue?.movers || {})) {
            if (!cueStorage.cues[cueName]) delete cue.movers[ch];
        }
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
        if (!util.isObject(parent) || !(prop in parent)) return undefined;
        parent = parent[prop];
    }

    return util.isObject(parent) ? parent : undefined;
}

function getDeleteTarget(storage, propChain, property) {
    const parent = getStoragePathParent(storage, propChain);
    if (parent) return parent;

    const reversedParent = getStoragePathParent(storage, [...propChain].reverse());
    if (reversedParent) return reversedParent;

    return undefined;
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

function moverSet(channel, values) {
    const mover = movers.find(m => m.channel === channel);

    if (!mover) {
        throw new Error(`No mover at channel ${msg.channel}`);
        return;
    }

    if (mover.channel === primaryMover.channel) {
        if (values.Zoom !== undefined)
            joystick1.zoom = values.Zoom;
        if (values.Pan !== undefined || values.PanFine !== undefined) {
            const panCoarse = values.Pan ?? (mover.channelValues.Pan ?? 0);
            const panFine = USE_FINE_CONTROL ? (values.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
            joystick1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
        }
        if (values.Tilt !== undefined || values.TiltFine !== undefined) {
            const tiltCoarse = values.Tilt ?? (mover.channelValues.Tilt ?? 0);
            const tiltFine = USE_FINE_CONTROL ? (values.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
            joystick1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
        }
    }

    if (mover.channel === gamepadMover.channel) {
        if (values.Zoom !== undefined) gamepad1.zoom = values.Zoom;
        if (values.Dimmer !== undefined) gamepad1.dimmer = values.Dimmer;
        if (values.Pan !== undefined || values.PanFine !== undefined) {
            const panCoarse = values.Pan ?? (mover.channelValues.Pan ?? 0);
            const panFine = USE_FINE_CONTROL ? (values.PanFine ?? (mover.channelValues.PanFine ?? 0)) : 0;
            gamepad1.x = ((panCoarse << 8) | panFine) / 65535 * 255;
        }
        if (values.Tilt !== undefined || values.TiltFine !== undefined) {
            const tiltCoarse = values.Tilt ?? (mover.channelValues.Tilt ?? 0);
            const tiltFine = USE_FINE_CONTROL ? (values.TiltFine ?? (mover.channelValues.TiltFine ?? 0)) : 0;
            gamepad1.y = ((tiltCoarse << 8) | tiltFine) / 65535 * 255;
        }
    }

    const translatedValues = Object.fromEntries(
        Object.entries(values).map(([channelName, value]) => [mover.CHANNELS[channelName], value])
    );
    applyMoverChannels(mover, translatedValues);
    updateState();
}

function sendToAllClients(message) {
    const stringifiedMessage = JSON.stringify(message);
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
    ws.send(JSON.stringify({
        type: 'CUE_STATE',
        cueNumber: currentCueNumber,
    }));
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
                syncConfiguredDmxChannels();
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
                syncConfiguredDmxChannels();
                break;
            }
            case 'MOVER_SET': {
                try {
                    moverSet(msg.channel, msg.values);
                }
                catch(e) {
                    ws.send(JSON.stringify({ type: 'ERROR', e}));
                }
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
                if(isNaN(msg.cueNumber) || !cueStorage.cueStack[msg.cueNumber]) {
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
                sendToAllClients({type: "CUE_STATE", cueNumber: currentCueNumber});
                saveCueStorage();
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

const CUE_APPLY_GROUPS = [
    { id: 'POS', keys: ['Pan', 'PanFine', 'Tilt', 'TiltFine'], defaultOn: true },
    { id: 'SPD', keys: ['PTSpeed'], defaultOn: true },
    { id: 'DM', keys: ['Dimmer'], defaultOn: true },
    { id: 'FZ', keys: ['Focus', 'Zoom'], defaultOn: true },
    { id: 'CO', keys: ['ColorWheel'], defaultOn: true },
    { id: 'GB', keys: ['GoboWheel', 'StaticGoboWheel'], defaultOn: true },
    { id: 'ROT', keys: ['GoboRotation'], defaultOn: true },
    { id: 'PS', keys: ['Prism'], defaultOn: true },
    { id: 'SH', keys: ['Shutter'], defaultOn: true },
    { id: 'FN', keys: ['Function', 'MovementMacros'], defaultOn: false },
];

const CUE_APPLY_KEYS = new Map(CUE_APPLY_GROUPS.flatMap(group => group.keys.map(key => [key, group.id])));
const CUE_FADE_GROUP_IDS = new Set(["POS", "SPD", "DM", "FZ"]);
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

function getDefaultCueApplyState() {
    return Object.fromEntries(CUE_APPLY_GROUPS.map(group => [group.id, group.defaultOn]));
}

function getCueApplyState(cue) {
    if (cue?.apply) return {...getDefaultCueApplyState(), ...cue.apply};

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

function getCueFadeTime(cue, attribute) {
    if (cue?.special === "stage") return 0;

    const groupId = CUE_APPLY_KEYS.get(attribute);
    const groupFade = Number.parseFloat(cue?.fadeTimes?.[groupId]);
    if (!Number.isNaN(groupFade)) return groupFade;

    const defaultFade = Number.parseFloat(cue?.fadeTime);
    return Number.isNaN(defaultFade) ? 0 : defaultFade;
}

function getCueNumberList() {
    return Object.keys(cueStorage.cueStack).map(parseFloat).sort((a, b) => a - b).map(x => x.toString());
}

function getNextCueNameForMover(cueNumber, ch) {
    const cueNumberList = getCueNumberList();
    const cueIndex = cueNumberList.indexOf(cueNumber.toString());
    if (cueIndex === -1) return undefined;

    for (const nextCueNumber of cueNumberList.slice(cueIndex + 1)) {
        const nextCueName = cueStorage.cueStack[nextCueNumber]?.movers?.[ch];
        if (nextCueName && nextCueName !== SPECIAL_CUE_STAGE) return nextCueName;
    }

    return undefined;
}

function getCueValuesForStackEntry(cueNumber, ch, cueName) {
    if (cueName !== SPECIAL_CUE_STAGE) return getCueValues(cueName);

    const nextCueName = getNextCueNameForMover(cueNumber, ch);
    const nextCueValues = nextCueName && nextCueName !== SPECIAL_CUE_STAGE ? getCueValues(nextCueName) : {};
    return {
        ...nextCueValues,
        Dimmer: 0,
    };
}

function goToCueNumber(cueNumber) {
    currentCueNumber = cueNumber.toString();
    sendToAllClients({type: "CUE_STATE", cueNumber: currentCueNumber});

    activeCueTweens.forEach(tId => clearInterval(tId));
    activeCueTweens = [];

    for(let [ch, cueName] of Object.entries(cueStorage.cueStack[cueNumber].movers)) {
        ch = Number.parseInt(ch);

        const cueToSet = getCueValuesForStackEntry(cueNumber, ch, cueName);
        const cueStackEntry = cueName === SPECIAL_CUE_STAGE ? getSpecialStageCue() : cueStorage.cueStack[cueNumber];

        const nonTweenableData = {...cueToSet};
        TWEENABLE_ATTRIBUTES.forEach(a => delete nonTweenableData[a]);
        moverSet(ch, nonTweenableData)

        for(const attribute of TWEENABLE_ATTRIBUTES) {
            const initialValue = movers.filter(m => m.channel == ch)[0].channelValues[attribute];
            const targetValue = cueToSet[attribute];
            if (targetValue === undefined) continue;

            const fadeTime = getCueFadeTime(cueStackEntry, attribute) * 1000;
            if (fadeTime <= 0 || initialValue === undefined) {
                moverSet(ch, {[attribute]: targetValue});
                continue;
            }

            let value  = initialValue;
            const startTime = performance.now();
            const intervalId = setInterval(() => {
                const elapsedTime = performance.now() - startTime;
                value = Math.floor(initialValue + (targetValue - initialValue) * (elapsedTime / fadeTime));
                if(elapsedTime >= fadeTime) {
                    value = targetValue;
                    clearInterval(intervalId);
                }
                moverSet(ch, {[attribute]: value});
            }, 16.7);

            activeCueTweens.push(intervalId);
        }
    }
}

function clearCurrentCue() {
    currentCueNumber = null;
    sendToAllClients({type: "CUE_STATE", cueNumber: currentCueNumber});
}

// const oscClient = new OSCClient("192.168.200.1", 8000);
// oscClient.send("/feedback/pb+exec");

const oscServer = new OSCServer(8001, "0.0.0.0");
oscServer.on("message", msg => {
    if(debug) console.log("RECEIVED OSC", msg);
    const path = msg[0].split("/");
    const [_, cmd, pb, cueNumber] = path;

    if (cmd != "pb" || !cueNumber || !cueStorage.cueStack[cueNumber]) return;

    goToCueNumber(cueNumber);


    // if (process.argv.includes("--use-quickq-feedback") && pb == 1) {
    //     const intensity = msg[1];
    //     console.log(pb, msg[1]);
    //     let data = {};
    //     let channelsToSet = [1, 2, 3, 4, 5];
    //     channelsToSet.forEach(c => data[c] = intensity);
    //     getDmx().setChannels(data);
    //     return;
    // }
});

server.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
});
