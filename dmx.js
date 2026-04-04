import { EnttecOpenDMXUSBDevice as EnttecDevice } from "enttec-open-dmx-usb";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import usb from "usb";

class DummyDevice {
    setChannels() { }
}

class UDMXDevice {
    constructor() {
        this.dev = usb.findByIds(0x16c0, 0x05dc);
        if (!this.dev) throw new Error("uDMX not found");
        this.dev.open();
        this.iface = this.dev.interface(0);
        if (this.iface.isKernelDriverActive()) this.iface.detachKernelDriver();
        this.iface.claim();
        this.started = false;
        this.buffer = Buffer.alloc(512);
    }

    _startSending() {
        if (this.started) return;
        this.started = true;
        this._sendLoop();
    }

    async _sendLoop() {
        if (!this.started) return;

        try {
            await new Promise((resolve, reject) => {
                this.dev.controlTransfer(
                    usb.LIBUSB_REQUEST_TYPE_VENDOR |
                    usb.LIBUSB_RECIPIENT_INTERFACE |
                    usb.LIBUSB_ENDPOINT_OUT,
                    0x0002,
                    this.buffer.length,
                    0,
                    this.buffer,
                    err => (err ? reject(err) : resolve())
                );
            });
        } catch (err) {
            console.error("DMX send error:", err);
        }

        setTimeout(() => this._sendLoop(), 50);
    }

    setChannels(channels) {
        for (const [channel, value] of Object.entries(channels)) {
            this.buffer[Number(channel) - 1] = value;
        }
        this._startSending();
    }
}

class PythonDMXDevice {
    constructor() {
        const scriptDir = path.dirname(fileURLToPath(import.meta.url));
        const venvPython = path.join(scriptDir, ".venv", "Scripts", "python.exe");
        if (!fs.existsSync(venvPython)) {
            throw new Error("Python venv not found at " + venvPython);
        }
        this.dead = false;
        this.proc = spawn(venvPython, [path.join(scriptDir, "test.py")], { stdio: ["pipe", "pipe", "pipe"] });
        this.ready = new Promise((resolve, reject) => {
            this.proc.stdout.on("data", data => {
                if (data.toString().trim() === "READY") resolve();
            });
            this.proc.on("exit", code => {
                this.dead = true;
                reject(new Error("Python DMX bridge exited with code " + code));
            });
        });
    }

    async setChannels(channels) {
        if (this.dead) return;
        try {
            await this.ready;
        } catch {
            return;
        }
        try {
            this.proc.stdin.write(JSON.stringify(channels) + "\n");
        } catch {
            this.dead = true;
        }
    }
}

/** @type {{ setChannels: (channels: Record<number, number>) => void }} */
let dmxDevice = new DummyDevice();

try {
    dmxDevice = new EnttecDevice(await EnttecDevice.getFirstAvailableDevice());
    console.log("Enttec Open DMX USB device found");
}
catch {
    try {
        dmxDevice = new UDMXDevice();
        console.log("uDMX device found (fallback)");
    }
    catch {
        try {
            dmxDevice = new PythonDMXDevice();
            await dmxDevice.ready;
            console.log("Python uDMX bridge started (fallback)");
        }
        catch (err) {
            console.log("No DMX hardware found, using dummy device" + (err.message ? " (" + err.message + ")" : ""));
        }
    }
}

export default function getDmx() {
    return dmxDevice;
}
