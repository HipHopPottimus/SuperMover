import { EnttecOpenDMXUSBDevice as EnttecDevice } from "enttec-open-dmx-usb";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const UDMX = require("udmx");

class DummyDevice {
    setChannels() {}
}

class UDMXAdapter {
    constructor() {
        this.device = new UDMX();
        this.device.connect();
    }

    setChannels(channels) {
        for (const [channel, value] of Object.entries(channels)) {
            this.device.set(Number(channel), value).catch(() => {});
        }
    }
}

/** @type {{ setChannels: (channels: Record<number, number>) => void }} */
let dmxDevice = new DummyDevice();

try {
    dmxDevice = new EnttecDevice(await EnttecDevice.getFirstAvailableDevice());
    console.log("Enttec Open DMX USB device found");
} catch {
    try {
        dmxDevice = new UDMXAdapter();
        console.log("uDMX device found (fallback)");
    } catch {
        console.error("No DMX device found (neither Enttec nor uDMX), using dummy device");
    }
}

export default function getDmx() {
    return dmxDevice;
}