import { EnttecOpenDMXUSBDevice as EnttecDevice } from "enttec-open-dmx-usb";
import usb from "usb";

class DummyDevice {
    setChannels() {}
}

class UDMXDevice {
    constructor() {
        this.dev = usb.findByIds(0x16c0, 0x05dc);
        if (!this.dev) throw new Error("uDMX not found");
        this.dev.open();
        this.started = false;
        this.buffer = new Uint8Array(512);
    }

    _startSending() {
        if (this.started) return;
        this.started = true;
        this._sendLoop();
    }

    _sendLoop() {
        if (!this.started) return;
        const promises = [];
        for (let i = 0; i < 512; i++) {
            promises.push(
                new Promise((resolve, reject) => {
                    this.dev.controlTransfer(
                        usb.LIBUSB_REQUEST_TYPE_VENDOR,
                        1,
                        this.buffer[i],
                        i,
                        Buffer.alloc(0),
                        err => (err ? reject(err) : resolve())
                    );
                }).catch(() => {})
            );
        }
        Promise.all(promises).then(() => {
            setTimeout(() => this._sendLoop(), 50);
        });
    }

    setChannels(channels) {
        for (const [channel, value] of Object.entries(channels)) {
            this.buffer[Number(channel) - 1] = value;
        }
        this._startSending();
    }
}

/** @type {{ setChannels: (channels: Record<number, number>) => void }} */
let dmxDevice = new DummyDevice();

try {
    dmxDevice = new EnttecDevice(await EnttecDevice.getFirstAvailableDevice());
    console.log("Enttec Open DMX USB device found");
} catch {
    try {
        dmxDevice = new UDMXDevice();
        console.log("uDMX device found (fallback)");
    } catch {
        console.error("No DMX device found (neither Enttec nor uDMX), using dummy device");
    }
}

export default function getDmx() {
    return dmxDevice;
}
