import usb from "usb";

const DEADZONE = 10;
const LOW_SENSITIVITY_X = 0.2;
const LOW_SENSITIVITY_Y = LOW_SENSITIVITY_X * 540 / 270;
const HIGH_SENSITIVITY_X = 1;
const HIGH_SENSITIVITY_Y = HIGH_SENSITIVITY_X * 540 / 270;
const NON_LINEAR_EXPONENT = 3;
const INVERT_X = true;
const INVERT_Y = false;
const UPDATE_INTERVAL_MS = 10;
const ZOOM_SENSITIVITY = 500;
const ZOOM_EASING = 0.2; // Lower is more eased

class Joystick {
    /** @type {usb.usb.Device} */
    device;

    /** @type {usb.Interface} */
    interface;

    /** @type {usb.Endpoint} */
    endpoint;

    /** @type {number[]} */
    rawData = [];

    /** @type {Function | undefined} */
    onData;

    /** @type {Function | undefined} */
    onUpdate;

    /** @type {number} */
    x = 170;

    /** @type {number} */
    y = 0;

    /** @type {number} */
    dX = 0;

    /** @type {number} */
    dY = 0;

    /** @type {number} */
    zoom = 0;

    /** @type {boolean} */
    dZ = 0;

    /** @type {number} */
    zoomVelocity = 0;

    /** @type {number} */
    throttle = 255;

    /** @type {ReturnType<typeof setInterval> | undefined} */
    updateTimer;

    /** @type {boolean} */
    USE_HIGH_SENSITIVITY = false;

    constructor(vendorId, productId) {
        this.device = usb.findByIds(vendorId, productId);
        if (!this.device) throw new Error("Joystick not found!");

        this.device.open();

        this.interface = this.device.interfaces?.[0];
        if (!this.interface) throw new Error("No interfaces on joystick!");

        try {
            if (this.interface.isKernelDriverActive()) this.interface.detachKernelDriver();
        } catch {
            // Some platforms do not expose kernel driver management.
        }

        this.interface.claim();

        this.endpoint = this.interface.endpoints.find((endpoint) => endpoint.direction === "in");
        if (!this.endpoint) throw new Error("No IN endpoint found");

        this.endpoint.on("data", (data) => {
            this.handleInput(data);
        });

        this.updateTimer = setInterval(() => {
            this.x = clamp(this.x + this.dX * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.y = clamp(this.y + this.dY * UPDATE_INTERVAL_MS / 1000, 0, 255);

            this.zoomVelocity += (this.dZ - this.zoomVelocity) * ZOOM_EASING;
            this.zoom = clamp(this.zoom + this.zoomVelocity * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.onUpdate?.();
        }, UPDATE_INTERVAL_MS);

        this.endpoint.startPoll();
    }

    handleInput(data) {
        this.rawData = Array.from(data);
        
        this.USE_HIGH_SENSITIVITY = data[3] & 1 ? true : false;

        const xInput = data[0];
        const yInput = data[1];
        const throttleInput = data[2] ?? 0;

        this.throttle = 255 - throttleInput;
        this.dX = mapAxis(xInput, INVERT_X) * (this.USE_HIGH_SENSITIVITY ? HIGH_SENSITIVITY_X : LOW_SENSITIVITY_X);
        this.dY = mapAxis(yInput, INVERT_Y) * (this.USE_HIGH_SENSITIVITY ? HIGH_SENSITIVITY_Y : LOW_SENSITIVITY_Y);

        this.dZ = data[3] >> 1 & 1 ? 1 * ZOOM_SENSITIVITY : data[3] >> 2 & 1 ? -ZOOM_SENSITIVITY : 0;
        this.onData?.();
    }

    destroy() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = undefined;
        }
    }
}

function mapAxis(value, invert) {
    const centered = invert ? 127 - value : value - 127;
    return scaleAxis(applyDeadzone(centered));
}

function applyDeadzone(value) {
    return Math.abs(value) < DEADZONE ? 0 : value;
}

function scaleAxis(value) {
    const normalized = value / 127;
    return Math.sign(normalized) * Math.pow(Math.abs(normalized), NON_LINEAR_EXPONENT) * 127;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export default {
    Joystick,
};