import usb from "usb";

const DEADZONE = 10;
const SENSITIVITY = 1;
const NON_LINEAR_EXPONENT = 3;
const INVERT_X = false;
const INVERT_Y = false;
const UPDATE_INTERVAL = 50;

class Joystick {
    /** @type {usb.usb.Device}*/
    device;

    /** @type {usb.Endpoint} */
    endpoint;

    /** @type {number[]} */
    rawData;

    /**@type {Function} */
    onData;

    //more accessible processed joystick data

    /**@type {number}*/
    x = 127;
    /**@type {number}*/
    y = 127;

    /**@type {number}*/
    dX = 0;
    /**@type {number}*/
    dY = 0;

    /**@type {number}*/
    throttle;

    constructor(vendorId, productId) {
        this.device = usb.findByIds(vendorId, productId);
        if (!this.device) throw new Error("Joystick not found!");

        this.device.open();

        if (!this.device.interfaces?.[0]) throw new Error("No interfaces on joystick!");
        let iface = this.device.interfaces[0];

        try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch { }
        iface.claim();

        this.endpoint = iface.endpoints.find(e => e.direction === "in");
        if (!this.endpoint) throw new Error("No IN endpoint found");

        this.endpoint.on("data", (data) => {
            this.rawData = data;
            this.throttle = 255 - data[2];

            this.dX = nonLinearMapping(applyDeadzone((INVERT_X * 2 - 1) * (data[0] - 127))) * SENSITIVITY;
            this.dY = nonLinearMapping(applyDeadzone((INVERT_Y * 2 - 1) * (data[1] - 127))) * SENSITIVITY;

            if (this.onData) this.onData();

            // console.log(`Got: ${data[0]}, ${data[1]} | dX: ${dX}, dY: ${dY}`);
        });

        setInterval(() => {
            this.x += this.dX * UPDATE_INTERVAL / 1000;
            this.y += this.dY * UPDATE_INTERVAL / 1000;

            this.x = clamp(this.x, 0, 255);
            this.y = clamp(this.y, 0, 255);
        }, UPDATE_INTERVAL);

        this.endpoint.startPoll();
    }
}

function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) return 0;
    return value;
}

function nonLinearMapping(value) {
    value = value / 127; // Normalize to -1 to 1
    return Math.sign(value) * Math.pow(Math.abs(value), NON_LINEAR_EXPONENT) * 127; // Non-linear mapping and scale back to -127 to 127
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

export default {
    Joystick
}