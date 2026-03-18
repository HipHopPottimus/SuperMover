import usb from "usb";
import Mover from "./mover.js";

const mover1 = new Mover.MyMover(1);

const DEADZONE = 10, SENSITIVITY = 10;

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

joystick.on("data", (data) => {
    dX = applyDeadzone(127 - data[0]) / SENSITIVITY;
    dY = applyDeadzone(127 - data[1]) / SENSITIVITY;
    // console.log(`Got: ${data[0]}, ${data[1]} | dX: ${dX}, dY: ${dY}`);
});

setInterval(() => {
    x += dX;
    y += dY;
    x = clamp(x, 0, 255);
    y = clamp(y, 0, 255);
    mover1.set({
        Pan: x,
        Tilt: y,
    });
}, 100);

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

console.log("Sending");