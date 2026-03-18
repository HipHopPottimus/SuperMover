import { EnttecOpenDMXUSBDevice as DMXDevice } from "enttec-open-dmx-usb";

// Singleton class

/** @type {DMXDevice} */
let dmxDevice = new DMXDevice("dummy");
try {
    dmxDevice = new DMXDevice(await DMXDevice.getFirstAvailableDevice());
} catch (error) {
    console.error("No DMX device found, using dummy device. Error:", error);
}

/**
 * @returns {DMXDevice}
 */
export default function getDmx() {
    return dmxDevice;
}