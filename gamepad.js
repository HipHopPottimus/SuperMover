import * as XInput from "xinput-ffi";

const BUTTONS = [
    "XINPUT_GAMEPAD_A",
    "XINPUT_GAMEPAD_B",
    "XINPUT_GAMEPAD_X",
    "XINPUT_GAMEPAD_Y",
    "XINPUT_GAMEPAD_LEFT_SHOULDER",
    "XINPUT_GAMEPAD_RIGHT_SHOULDER",
    "XINPUT_GAMEPAD_LEFT_THUMB",
    "XINPUT_GAMEPAD_RIGHT_THUMB",
    "XINPUT_GAMEPAD_DPAD_UP",
    "XINPUT_GAMEPAD_DPAD_DOWN",
    "XINPUT_GAMEPAD_DPAD_LEFT",
    "XINPUT_GAMEPAD_DPAD_RIGHT",
    "XINPUT_GAMEPAD_START",
    "XINPUT_GAMEPAD_BACK",
];

// Normalize a stick axis to -1.0 .. +1.0
function normalizeAxis(value) {
    return value / (value < 0 ? 32768 : 32767);
}

async function getGamepadState(index = 0) {
    const { gamepad } = await XInput.getState(index);
    const held = new Set(gamepad.wButtons);

    return {
        buttons: Object.fromEntries(BUTTONS.map(b => [
            b.replace("XINPUT_GAMEPAD_", "").toLowerCase(),
            held.has(b)
        ])),
        triggers: {
            left:  gamepad.bLeftTrigger  / 255,
            right: gamepad.bRightTrigger / 255,
        },
        sticks: {
            left:  { x: normalizeAxis(gamepad.sThumbLX), y: normalizeAxis(gamepad.sThumbLY) },
            right: { x: normalizeAxis(gamepad.sThumbRX), y: normalizeAxis(gamepad.sThumbRY) },
        },
    };
}


setInterval(async () => {
    const state = await getGamepadState();
    console.clear();
    console.log(state);
}, 1000 / 60);
