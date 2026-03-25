import * as XInput from "xinput-ffi";

let has_gamepad_errored = false;

const DEADZONE = 0.05;
const HIGH_SENSITIVITY_X = 127;
const HIGH_SENSITIVITY_Y = HIGH_SENSITIVITY_X * 540 / 270;
const LOW_SENSITIVITY_X = 25.4;
const LOW_SENSITIVITY_Y = LOW_SENSITIVITY_X * 540 / 270;
const ZOOM_SENSITIVITY = 500;
const DIMMER_SENSITIVITY = 500;
const ZOOM_EASING = 0.4;
const UPDATE_INTERVAL_MS = 10;

export class Gamepad {
    /** @type {number} 0-255 pan position */
    x = 127;

    /** @type {number} 0-255 tilt position */
    y = 127;

    /** @type {number} 0-255 zoom position */
    zoom = 0;

    /** @type {number} */
    zoomVelocity = 0;

    /** @type {number} 0-255 dimmer */
    dimmer = 255;

    /** @type {number} */
    dimmerVelocity = 0;

    /** @type {Function | undefined} */
    onUpdate;

    _dX = 0;
    _dY = 0;
    _dZ = 0;
    _dDimmer = 0;
    _index;
    _pollTimer;
    _updateTimer;

    constructor(controllerIndex = 0) {
        this._index = controllerIndex;

        this._pollTimer = setInterval(async () => {
            try {
                const { gamepad } = await XInput.getState(this._index);
                this._handleState(gamepad);
            } catch (err) {
                if (has_gamepad_errored) return;
                console.error("Failed to get gamepad state:", err);
                has_gamepad_errored = true;
            }
        }, 1000 / 60);

        this._updateTimer = setInterval(() => {
            this.x = clamp(this.x + this._dX * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.y = clamp(this.y + this._dY * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.zoomVelocity += (this._dZ - this.zoomVelocity) * ZOOM_EASING;
            this.zoom = clamp(this.zoom + this.zoomVelocity * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.dimmerVelocity += (this._dDimmer - this.dimmerVelocity) * ZOOM_EASING;
            this.dimmer = clamp(this.dimmer + this.dimmerVelocity * UPDATE_INTERVAL_MS / 1000, 0, 255);
            this.onUpdate?.();
        }, UPDATE_INTERVAL_MS);
    }

    _handleState(gamepad) {
        const held = new Set(gamepad.wButtons);

        const rightTrigger = gamepad.bRightTrigger / 255;
        const leftTrigger = gamepad.bLeftTrigger / 255;
        this._dDimmer = (rightTrigger - leftTrigger) * DIMMER_SENSITIVITY;

        const lx = applyDeadzone(normalizeAxis(gamepad.sThumbLX));
        const ly = applyDeadzone(normalizeAxis(gamepad.sThumbLY));

        const rx = applyDeadzone(normalizeAxis(gamepad.sThumbRX));
        const ry = applyDeadzone(normalizeAxis(gamepad.sThumbRY));

        this._dX = (-lx * HIGH_SENSITIVITY_X) + (-rx * LOW_SENSITIVITY_X);
        this._dY = (-ly * HIGH_SENSITIVITY_Y) + (-ry * LOW_SENSITIVITY_Y);
        this._dZ = held.has("XINPUT_GAMEPAD_DPAD_DOWN") ? ZOOM_SENSITIVITY : held.has("XINPUT_GAMEPAD_DPAD_UP") ? -ZOOM_SENSITIVITY : 0;
    }

    destroy() {
        clearInterval(this._pollTimer);
        clearInterval(this._updateTimer);
    }
}

function normalizeAxis(value) {
    return value / (value < 0 ? 32768 : 32767);
}

function applyDeadzone(value) {
    return Math.abs(value) < DEADZONE ? 0 : value;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export default { Gamepad };
