import { EnttecOpenDMXUSBDevice as EnttecDevice } from "enttec-open-dmx-usb";
import usb from "usb";
import WebSocket from "ws";
import { sendError } from "./main.js";

const DEFAULT_FPS = parsePositiveInt(process.env.DMX_FPS, 30);
const UNIVERSE_SIZE = 32;
const DEBUG_TRANSPORT = process.env.DMX_DEBUG === "true";

class DummyBackend {
    name = "dummy";

    async sendUniverse() { }
}

class QLCPlusWebsocketBackend {
    name = "qlc-plus-websocket";

    constructor() {
        this.ws = null;
        this.device = null;
        this.ready = this.#init();
    }

    #init() {
        return new Promise((res, rej) => {
            let opened = false;
            this.ws = new WebSocket("ws://127.0.0.1:9999/qlcplusWS");
            this.ws.on('open', () => {
                opened = true;
                res();
            })
            this.ws.on('error', (err) => {
                rej(err);
            });
            this.ws.on('close', () => {
                if (!opened) return;
                sendError("Disconnected from QLC+ Backend! Shutting down now.");
                console.error('ERROR! Disconnected from QLC+ Backend!!!');
                throw new Error("Disconnect from QLC+ WS!");
            });
        })
    }

    async sendUniverse(universe) {
        await this.ready;
        for (let i = 0; i < universe.length; i++) {
            // CH|{address}|{value} to set value    
            this.ws.send(`CH|${i + 1}|${universe[i]}`);
        }
    }
}

class EnttecOpenDMXUSBBackend {
    name = "enttec-open-dmx-usb";

    constructor() {
        this.device = null;
        this.ready = this.#init();
    }

    async #init() {
        const devicePath = await EnttecDevice.getFirstAvailableDevice();
        this.device = new EnttecDevice(devicePath, false);
        await waitForEnttecReady(this.device);
    }

    async sendUniverse(universe) {
        await this.ready;
        this.device.setChannels(Buffer.from(universe));
        await this.device._sendUniverse();
    }
}

class UDMXBackend {
    name = "udmx";

    constructor() {
        this.dev = usb.findByIds(0x16c0, 0x05dc);
        if (!this.dev) throw new Error("uDMX not found");
        this.dev.open();
        this.iface = this.dev.interface(0);
        try {
            if (this.iface.isKernelDriverActive()) this.iface.detachKernelDriver();
        } catch {
            // Some platforms do not expose kernel driver management.
        }
        this.iface.claim();
    }

    async sendUniverse(universe) {
        const buffer = Buffer.from(universe);
        await new Promise((resolve, reject) => {
            this.dev.controlTransfer(
                usb.LIBUSB_REQUEST_TYPE_VENDOR |
                usb.LIBUSB_RECIPIENT_INTERFACE |
                usb.LIBUSB_ENDPOINT_OUT,
                0x0002,
                buffer.length,
                0,
                buffer,
                err => (err ? reject(err) : resolve())
            );
        });
    }
}

class DMXUniverseManager {
    constructor(backend, options = {}) {
        this.backend = backend;
        this.fps = parsePositiveInt(options.fps, DEFAULT_FPS);
        this.intervalMs = Math.max(1, Math.round(1000 / this.fps));
        this.debug = options.debug ?? DEBUG_TRANSPORT;
        this.universe = Buffer.alloc(UNIVERSE_SIZE, 0);
        this.pendingFrame = false;
        this.writeInFlight = false;
        this.writeQueued = false;
        this.timer = null;
        this.lastChangedChannels = [];
        this.stats = {
            framesSent: 0,
            droppedFrames: 0,
            writeErrors: 0,
            writeDurationMs: 0,
            avgWriteDurationMs: 0,
            lastWriteStartedAt: 0,
            lastWriteFinishedAt: 0,
            startedAt: 0,
            lastStatsLoggedAt: 0,
        };
    }

    start() {
        if (this.timer) return;
        this.stats.startedAt = Date.now();
        this.stats.lastStatsLoggedAt = Date.now();
        this.timer = setInterval(() => {
            void this.#tick();
        }, this.intervalMs);
        if (typeof this.timer.unref === "function") this.timer.unref();
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    getUniverse() {
        return Buffer.from(this.universe);
    }

    setChannel(channel, value) {
        const sanitizedChannel = sanitizeChannel(channel);
        if (sanitizedChannel === null) return false;

        const sanitizedValue = sanitizeValue(value);
        const index = sanitizedChannel - 1;
        if (this.universe[index] === sanitizedValue) return false;

        this.universe[index] = sanitizedValue;
        this.pendingFrame = true;
        this.#noteChangedChannels([sanitizedChannel]);
        return true;
    }

    setChannels(channels) {
        if (!channels || typeof channels !== "object") return [];

        const changed = [];
        for (const [channel, value] of Object.entries(channels)) {
            const sanitizedChannel = sanitizeChannel(channel);
            if (sanitizedChannel === null) continue;

            const sanitizedValue = sanitizeValue(value);
            const index = sanitizedChannel - 1;
            if (this.universe[index] === sanitizedValue) continue;

            this.universe[index] = sanitizedValue;
            changed.push(sanitizedChannel);
        }

        if (changed.length > 0) {
            this.pendingFrame = true;
            this.#noteChangedChannels(changed);
        }

        return changed;
    }

    getStats() {
        const runtimeMs = Math.max(1, Date.now() - (this.stats.startedAt || Date.now()));
        return {
            backend: this.backend.name,
            fpsTarget: this.fps,
            fpsActual: this.stats.framesSent / (runtimeMs / 1000),
            framesSent: this.stats.framesSent,
            droppedFrames: this.stats.droppedFrames,
            writeErrors: this.stats.writeErrors,
            writeDurationMs: this.stats.writeDurationMs,
            avgWriteDurationMs: this.stats.avgWriteDurationMs,
            lastChangedChannels: [...this.lastChangedChannels],
            writeInFlight: this.writeInFlight,
            pendingFrame: this.pendingFrame,
        };
    }

    async #tick() {
        if (this.writeInFlight) {
            this.writeQueued = true;
            this.stats.droppedFrames += 1;
            this.#logStatsIfNeeded();
            return;
        }

        this.writeInFlight = true;
        const hadPendingChanges = this.pendingFrame;
        this.pendingFrame = false;
        this.writeQueued = false;
        this.stats.lastWriteStartedAt = Date.now();
        const frame = Buffer.from(this.universe);
        const started = performance.now();

        try {
            await this.backend.sendUniverse(frame);
            this.stats.framesSent += 1;
            this.stats.writeDurationMs = performance.now() - started;
            this.stats.avgWriteDurationMs = weightedAverage(this.stats.avgWriteDurationMs, this.stats.writeDurationMs, this.stats.framesSent);
            this.stats.lastWriteFinishedAt = Date.now();
        } catch (error) {
            this.stats.writeErrors += 1;
            console.error("DMX send error:", error);
        } finally {
            this.writeInFlight = false;
        }

        if (this.writeQueued || this.pendingFrame || hadPendingChanges) {
            queueMicrotask(() => {
                void this.#tick();
            });
        }

        this.#logStatsIfNeeded();
    }

    #noteChangedChannels(channels) {
        const merged = new Set([...this.lastChangedChannels, ...channels]);
        this.lastChangedChannels = [...merged].sort((a, b) => a - b).slice(0, 64);
    }

    #logStatsIfNeeded() {
        if (!this.debug) return;
        const now = Date.now();
        if (now - this.stats.lastStatsLoggedAt < 1000) return;
        this.stats.lastStatsLoggedAt = now;
        const stats = this.getStats();
        console.log("[DMX]", JSON.stringify({
            backend: stats.backend,
            fpsTarget: stats.fpsTarget,
            fpsActual: round(stats.fpsActual, 1),
            framesSent: stats.framesSent,
            droppedFrames: stats.droppedFrames,
            writeErrors: stats.writeErrors,
            writeDurationMs: round(stats.writeDurationMs, 2),
            avgWriteDurationMs: round(stats.avgWriteDurationMs, 2),
            lastChangedChannels: stats.lastChangedChannels,
            writeInFlight: stats.writeInFlight,
            pendingFrame: stats.pendingFrame,
        }));
    }
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeChannel(channel) {
    const parsed = Number.parseInt(channel, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > UNIVERSE_SIZE) return null;
    return parsed;
}

function sanitizeValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(255, Math.round(numeric)));
}

function weightedAverage(previousAverage, nextValue, sampleCount) {
    if (sampleCount <= 1) return nextValue;
    return previousAverage + ((nextValue - previousAverage) / sampleCount);
}

function round(value, digits) {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
}

async function waitForEnttecReady(device) {
    if (device.port?.isOpen) return;
    await new Promise((resolve, reject) => {
        device.once("ready", resolve);
        device.once("error", reject);
    });
}

async function createBackend() {
    try {
        console.log("Trying QLC+...");
        const backend = new QLCPlusWebsocketBackend();
        await backend.ready;
        console.log("Connected to QLC+ backend!");
        return backend;
    } catch {
        try {
            console.log("Failed! Trying EnttecOpenDMX");
            const backend = new EnttecOpenDMXUSBBackend();
            await backend.ready;
            console.log("Enttec Open DMX USB device found");
            return backend;

        } catch {
            try {
                console.log("Failed! Trying uDMX...");
                const backend = new UDMXBackend();
                console.log("uDMX device found (fallback)");
                return backend;
            } catch {
                console.log("No DMX hardware found, using dummy device" + (err?.message ? " (" + err.message + ")" : ""));
                return new DummyBackend();
            }
        }
    }
}

const dmxDevice = new DMXUniverseManager(await createBackend(), {
    fps: DEFAULT_FPS,
    debug: DEBUG_TRANSPORT,
});

export default function getDmx() {
    return dmxDevice;
}
