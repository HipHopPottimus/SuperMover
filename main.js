import usb from "usb";
import dmx from "./dmx";

dmx.init();

const DEADZONE = 1, SENSITIVITY = 10;

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

joystick.on("data", (data) => {
    dX = (255 - (data[0] - 127)) / SENSITIVITY;
    dY = (255 - (data[1] - 127)) / SENSITIVITY;
});

setInterval(() => {
    x += dX;
    y += dY;
    x = clamp(x, 0, 255);
    y = clamp(y, 0, 255);
    dmx.setChannels({
        [dmx.CHANNELS.Pan]: x,
        [dmx.CHANNELS.Tilt]: y
    });
}, 100);

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

console.log("Sending");