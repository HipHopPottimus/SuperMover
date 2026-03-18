import usb from "usb";
import Mover from "./mover.js";

const mover1 = new Mover.MyMover(1, process.env.debug === "true");

const DEADZONE = 10;
const SENSITIVITY = 3;
const UPDATE_INTERVAL = 30; // ms
const NON_LINEAR_EXPONENT = 3;
const INVERT_X = false;
const INVERT_Y = false;

function getJoystick(vendorId, productId) {
    let device = usb.findByIds(vendorId, productId);
    if (!device) throw new Error("Joystick not found!");

    device.open();

    if (!device.interfaces?.[0]) throw new Error("No interfaces on joystick!");
    let iface = device.interfaces[0];

    try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch { }
    iface.claim();

    let endpoint = iface.endpoints.find(e => e.direction === "in");
    if (!endpoint) throw new Error("No IN endpoint found");

    endpoint.startPoll();

    return endpoint;
}

let joystick = getJoystick(0x046d, 0xc214);

let dX = 0, dY = 0, x = 0, y = 0;

function applyDeadzone(value) {
    if (Math.abs(value) < DEADZONE) return 0;
    return value;
}

function nonLinearMapping(value) {
    value = value / 127; // Normalize to -1 to 1
    return Math.sign(value) * Math.pow(Math.abs(value), NON_LINEAR_EXPONENT) * 127; // Non-linear mapping and scale back to -127 to 127
}

joystick.on("data", (data) => {
    const throttle = 255 - data[2];

    mover1.set({
        Dimmer: throttle,
    });

    if (data[3]) 
        mover1.set({ ColorWheel: Math.floor(Math.log2(data[3])) * 8 });

    dX = nonLinearMapping(applyDeadzone((INVERT_X * 2 - 1) * (data[0] - 127))) * SENSITIVITY;
    dY = nonLinearMapping(applyDeadzone((INVERT_Y * 2 - 1) * (data[1] - 127))) * SENSITIVITY;

    // console.log(`Got: ${data[0]}, ${data[1]} | dX: ${dX}, dY: ${dY}`);
});

setInterval(() => {
    x += dX / UPDATE_INTERVAL;
    y += dY / UPDATE_INTERVAL;
    x = clamp(x, 0, 255);
    y = clamp(y, 0, 255);
    // console.log(x, y);
    mover1.set({
        Pan: x,
        Tilt: y,
    });
}, UPDATE_INTERVAL);

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

console.log("Sending");