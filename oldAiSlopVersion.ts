import usb from "usb";
import * as readline from "readline";
import { EnttecOpenDMXUSBDevice } from "enttec-open-dmx-usb";
import promptSync from "prompt-sync";

const prompt = promptSync({ sigint: true });
const useFakeDMX = process.env["USE_FAKE_DMX"] === "1";

let entDev: EnttecOpenDMXUSBDevice;
const enntecDevices = await EnttecOpenDMXUSBDevice.listDevices();
if (enntecDevices.length === 0 && !useFakeDMX) {
    console.error("No Enttec Open DMX USB devices found. Set USE_FAKE_DMX=1 to use a fake device for testing.");
    process.exit(1);
} else if (!useFakeDMX) {
    const path = await EnttecOpenDMXUSBDevice.getFirstAvailableDevice();
    entDev = new EnttecOpenDMXUSBDevice(path);
} else if (enntecDevices.length === 0 && useFakeDMX) {
    console.warn("Using fake DMX device for testing.");
    entDev = new EnttecOpenDMXUSBDevice("FAKE");
} else {
    process.exit(1); // shouldn't happen: if devices found, we use the real one, not fake
}

let ch = 1;
let panOffset = 0, panFOffset = 1, tiltOffset = 2, tiltFOffset = 3, ptSpeedOffset = 4;

if (prompt("Use default channel mapping? (y/n) -> ").trim().toLowerCase() === "n") {
    ch = parseInt(prompt("Enter DMX start channel (default: 1) -> ") || "1");
    panOffset = parseInt(prompt("Enter coarse pan offset (default: 0) -> ") || "0");
    panFOffset = parseInt(prompt("Enter fine pan offset (default: 1) -> ") || "1");
    tiltOffset = parseInt(prompt("Enter coarse tilt offset (default: 2) -> ") || "2");
    tiltFOffset = parseInt(prompt("Enter fine tilt offset (default: 3) -> ") || "3");
    ptSpeedOffset = parseInt(prompt("Enter pan/tilt speed offset (default: 4) -> ") || "4");
}

const panch = ch + panOffset;
const panFinech = ch + panFOffset;
const tiltch = ch + tiltOffset;
const tiltFinech = ch + tiltFOffset;
const ptSpeedch = ch + ptSpeedOffset;

console.log(`Using chs: base ${ch} | pan @ ${panch} | pan fine @ ${panFinech} | tilt @ ${tiltch} | tilt fine @ ${tiltFinech} | pt speed @ ${ptSpeedch}`);

// --- State ---
let swapXY = false, invertX = false, invertY = false, cubicMapping = true;
let xSensitivity = 270, ySensitivity = 540;
let pan = 32767, tilt = 32767;   // start centred (mid of 0–65535)

// Deadzone: ignore tiny joystick noise around centre
const DEADZONE = 10;

function split(value: number): [number, number] {
    return [(value >> 8) & 0xFF, value & 0xFF];
}

function applyDeadzone(v: number): number {
    return Math.abs(v) < DEADZONE ? 0 : v;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

// --- Joystick ---
const VENDOR_ID = 0x046d, PRODUCT_ID = 0xc214; const device = usb.findByIds(VENDOR_ID, PRODUCT_ID);
if (!device) throw new Error("Joystick not found!");

device.open();

if (!device.interfaces?.[0]) throw new Error("No interfaces on joystick!");
const iface = device.interfaces[0];

try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch { }
iface.claim();

const endpoint = iface.endpoints.find(e => e.direction === "in");
if (!endpoint) throw new Error("No IN endpoint found");
const inEndpoint = endpoint as usb.InEndpoint;

// Last joystick axes, updated on every HID report
let axisX = 0, axisY = 0;

inEndpoint.on("data", (data: Buffer) => {
    axisX = applyDeadzone(data[0] - 127);
    axisY = applyDeadzone(data[1] - 127);
});

inEndpoint.on("error", (err) => console.error("Joystick error:", err));
inEndpoint.startPoll();

// Fixed-rate output tick (~50 Hz)
const TICK_MS = 20;
setInterval(() => {
    let dx = swapXY ? axisY : axisX;
    let dy = swapXY ? axisX : axisY;
    if (invertX) dx = -dx;
    if (invertY) dy = -dy;

    const mapAxis = (v: number) => cubicMapping ? (v / 127) ** 3 * 127 : v;
    const panDelta = Math.round((mapAxis(dx) / 127) * (xSensitivity / 540) * 65535 * (TICK_MS / 1000));
    const tiltDelta = Math.round((mapAxis(dy) / 127) * (ySensitivity / 270) * 65535 * (TICK_MS / 1000));

    pan = clamp(pan + panDelta, 0, 65535);
    tilt = clamp(tilt + tiltDelta, 0, 65535);

    const [panCoarse, panFine] = split(pan);
    const [tiltCoarse, tiltFine] = split(tilt);

    const panDeg = (pan / 65535 * 540).toFixed(2);
    const tiltDegA = (tilt / 65535 * 270).toFixed(2);
    const tiltDegB = (tilt / 65535 * 234).toFixed(2);

    // process.stdout.write(`\x1b[2KPan: ${panDeg.padStart(6)}, Tilt: ${tiltDegA.padStart(6)}/${tiltDegB.padStart(6)}\r`);

    entDev.setChannels({
        [panch]: panCoarse,
        [panFinech]: panFine,
        [tiltch]: tiltCoarse,
        [tiltFinech]: tiltFine,
        [ptSpeedch]: 0,
    });
}, TICK_MS);

entDev.once('ready', () => entDev.startSending());

// --- Command interface (async readline — doesn't block the event loop) ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function shutDown() {
    console.log("Exiting...");
    entDev.stopSending();
    inEndpoint.stopPoll(() => {
        if (device) iface.release(() => { device.close(); process.exit(); });
    });
    rl.close();
    process.exit(1);
}
const ask = () => rl.question("/> ", handleCmd);

function handleCmd(cmd: string) {
    const parts = cmd.trim().toLowerCase().split(" ");
    switch (parts[0]) {
        case "help":
            console.log(`Commands:
  swap              toggle swap X/Y (${swapXY ? "ON" : "OFF"})
  cubic             toggle cubic vs linear mapping (${cubicMapping ? "cubic" : "linear"})
  invertx           toggle invert X (${invertX ? "ON" : "OFF"})
  inverty           toggle invert Y (${invertY ? "ON" : "OFF"})
  xsens <value>     X sensitivity (${xSensitivity})
  ysens <value>     Y sensitivity (${ySensitivity})
  centre            reset pan/tilt to centre
  pos               show current pan/tilt position
  exit              quit the program`);
            break;
        case "swap": swapXY = !swapXY; console.log(`Swap XY: ${swapXY}`); break;
        case "cubic": cubicMapping = !cubicMapping; console.log(`Cubic mapping: ${cubicMapping ? "ON" : "OFF"}`); break;
        case "invertx": invertX = !invertX; console.log(`Invert X: ${invertX}`); break;
        case "inverty": invertY = !invertY; console.log(`Invert Y: ${invertY}`); break;
        case "centre":
            pan = tilt = 32767;
            console.log("Centred.");
            break;
        case "pos": {
            const panDeg = (pan / 65535 * 540).toFixed(2);
            const tiltDegA = (tilt / 65535 * 270).toFixed(2);
            const tiltDegB = (tilt / 65535 * 234).toFixed(2);
            console.log(`Pan: ${panDeg}°  Tilt: ${tiltDegA}°/${tiltDegB}°  (raw: ${pan} / ${tilt})`);
            break;
        }
        case "xsens": {
            const v = parseFloat(parts[1]);
            if (!parts[1] || isNaN(v) || v <= 0) { console.log("Usage: xsens <positive number>"); break; }
            xSensitivity = v;
            console.log(`X sensitivity: ${xSensitivity}`);
            break;
        }
        case "ysens": {
            const v = parseFloat(parts[1]);
            if (!parts[1] || isNaN(v) || v <= 0) { console.log("Usage: ysens <positive number>"); break; }
            ySensitivity = v;
            console.log(`Y sensitivity: ${ySensitivity}`);
            break;
        }
        case "exit":
            shutDown();
        default:
            if (parts[0]) console.log(`Unknown command: ${parts[0]}. Type 'help'.`);
    }
    ask();
}

ask();

process.on("SIGINT", () => {
    shutDown();
});
rl.on("SIGINT", () => {
    shutDown();
});