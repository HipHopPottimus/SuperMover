/* CHANNELS depend on fixture type (see fixtures.js)
 * 375z (15ch): Pan, PanFine, Tilt, TiltFine, PTSpeed, ColorWheel, GoboWheel, GoboRotation,
 *              Prism, Focus, Dimmer, Shutter, Function, MovementMacros, Zoom
 * 475z (16ch): Pan, PanFine, Tilt, TiltFine, PTSpeed, ColorWheel, GoboWheel, GoboRotation,
 *              StaticGoboWheel, Prism, Focus, Zoom, Dimmer, Shutter, Function, MovementMacros
 *
 * Channel value ranges vary between fixtures (see constants below).
 */

import getDmx from "./dmx.js";
import { getFixtureProfile } from "./fixtures.js";

export class Mover {
    /** @type {number} Start channel */
    channel;

    /** @type {string} Fixture type key (e.g. '375z', '475z') */
    fixtureType;

    /** @type {Record<number, number>} */
    channelValues = {};

    debug = false;

    constructor(channel = 1, debug = false, fixtureType = '375z') {
        this.channel = channel;
        this.debug = debug;
        this.fixtureType = fixtureType;

        this.reset();
    }

    get fixtureProfile() {
        return getFixtureProfile(this.fixtureType);
    }

    get CHANNELS() {
        const ch = {};
        for (let i = 0; i < this.fixtureProfile.channels.length; i++) {
            ch[this.fixtureProfile.channels[i]] = this.channel + i;
        }
        return ch;
    }

    get channelCount() {
        return this.fixtureProfile.channelCount;
    }

    setPanDeg(deg, useFine = false) {
        const value = Math.round(deg / 540 * 65535);
        if (useFine) {
            const coarse = value >> 8 & 0xFF;
            const fine = value & 0xFF;
            this.set({ Pan: coarse, PanFine: fine });
            return;
        }
        this.set({ Pan: value >> 8 & 0xFF });
    }

    setTiltDeg(deg, useFine = false) {
        const value = Math.round(deg / 270 * 65535);
        if (useFine) {
            const coarse = value >> 8 & 0xFF;
            const fine = value & 0xFF;
            this.set({ Tilt: coarse, TiltFine: fine });
            return;
        }
        this.set({ Tilt: value >> 8 & 0xFF });
    }

    /**
     * @param {Record<keyof typeof this.CHANNELS, number>} vals
     * @returns {void}
     */
    set(vals) {
        vals = Object.fromEntries(Object.entries(vals).map(([k, v]) => [this.CHANNELS[k], v]));
        this.setChannels(vals);
    }

    /**
     * @param {Record<number, number>} channels
     */
    setChannels(channels) {
        this.channelValues = {...this.channelValues, ...channels};
        for(const [channelName, channel] of Object.entries(this.CHANNELS)) {
            this.channelValues[channelName] = this.channelValues[channel];
        }
        getDmx().setChannels(channels);
    }

    reset() {
        const SHUTTER_CONSTANTS = this.fixtureType === '475z' ? SHUTTER_475Z : SHUTTER_375Z;
        const GOBO_CONSTANTS = this.fixtureType === '475z' ? GOBO_475Z : GOBO_375Z;
        const PRISM_CONSTANTS = this.fixtureType === '475z' ? PRISM_475Z : PRISM_375Z;
        const GOBO_ROT_CONSTANTS = this.fixtureType === '475z' ? GOBO_ROTATION_475Z : GOBO_ROTATION_375Z;

        const base = {
            Shutter: SHUTTER_CONSTANTS.Open,
            ColorWheel: COLORS.White,
            GoboWheel: GOBO_CONSTANTS.Open,
            GoboRotation: GOBO_ROT_CONSTANTS.NoFunction,
            Prism: PRISM_CONSTANTS.NoFunction,
            Function: 0,
            Focus: 0,
            Dimmer: 0,
            Pan: 127,
            PanFine: 127,
            Tilt: 127,
            TiltFine: 127,
            PTSpeed: 0,
            MovementMacros: 0,
        };

        if (this.fixtureType === '475z') {
            base.Zoom = 0;
            base.StaticGoboWheel = STATIC_GOBO_475Z.Open;
        } else {
            base.Zoom = 0;
        }

        this.set(base);
    }
}

// --- Color Wheel (shared between both fixtures) ---
export const COLORS = {
    White: 0,
    MediumBastardAmber: 8,
    LimeGreen: 16,
    Cyan: 24,
    Red: 32,
    Green: 40,
    Magenta: 48,
    Yellow: 56,
    ColorIndexing: function (index) { return 64 + Math.round(125 * Math.max(Math.min(1, index), 0)); },
    ColorCycle: function (speed) { return 190 + Math.round(31 * Math.max(Math.min(1, speed), 0)); },
    ReverseColorCycle: function (speed) { return 222 + Math.round(33 * Math.max(Math.min(1, speed), 0)); }
}

// --- 375z Gobo Wheel ---
export const GOBO_375Z = {
    Open: 0,
    Gobo1: 8, Gobo2: 16, Gobo3: 24, Gobo4: 32, Gobo5: 40, Gobo6: 48, Gobo7: 56,
    Gobo7Shake: function (s) { return 64 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo6Shake: function (s) { return 72 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo5Shake: function (s) { return 80 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo4Shake: function (s) { return 88 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo3Shake: function (s) { return 96 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo2Shake: function (s) { return 104 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo1Shake: function (s) { return 112 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    CycleEffect: function (s) { return 128 + Math.round(61 * Math.max(Math.min(1, s), 0)); },
    CycleEffectReverse: function (s) { return 194 + Math.round(61 * Math.max(Math.min(1, s), 0)); },
}

// --- 475z Rotating Gobo Wheel ---
export const GOBO_475Z = {
    Open: 0,
    Gobo1: 8, Gobo2: 16, Gobo3: 24, Gobo4: 32, Gobo5: 40, Gobo6: 48, Gobo7: 56,
    Gobo7Shake: function (s) { return 64 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo6Shake: function (s) { return 72 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo5Shake: function (s) { return 80 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo4Shake: function (s) { return 88 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo3Shake: function (s) { return 96 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo2Shake: function (s) { return 104 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo1Shake: function (s) { return 112 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Open2: 120,
    CycleEffect: function (s) { return 128 + Math.round(63 * Math.max(Math.min(1, s), 0)); },
    CycleEffectReverse: function (s) { return 192 + Math.round(63 * Math.max(Math.min(1, s), 0)); },
}

// --- 475z Static Gobo Wheel ---
export const STATIC_GOBO_475Z = {
    Open: 0,
    Gobo1: 7, Gobo2: 14, Gobo3: 21, Gobo4: 28, Gobo5: 35, Gobo6: 42, Gobo7: 49, Gobo8: 56,
    Gobo8Shake: function (s) { return 64 + Math.round(7 * Math.max(Math.min(1, s), 0)); },
    Gobo7Shake: function (s) { return 72 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo6Shake: function (s) { return 79 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo5Shake: function (s) { return 86 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo4Shake: function (s) { return 93 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo3Shake: function (s) { return 100 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo2Shake: function (s) { return 107 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Gobo1Shake: function (s) { return 114 + Math.round(6 * Math.max(Math.min(1, s), 0)); },
    Open2: 121,
    ReverseCycle: function (s) { return 128 + Math.round(63 * Math.max(Math.min(1, s), 0)); },
    CycleEffect: function (s) { return 192 + Math.round(63 * Math.max(Math.min(1, s), 0)); },
}

// --- 375z Gobo Rotation ---
export const GOBO_ROTATION_375Z = {
    NoFunction: 0,
    GoboIndexing: function (index) { return 1 + Math.round(62 * Math.max(Math.min(1, index), 0)); },
    Rotation: function (speed) { return 64 + Math.round(81 * Math.max(Math.min(1, speed), 0)); },
    Stop: 146,
    ReverseRotation: function (speed) { return 150 + Math.round(81 * Math.max(Math.min(1, speed), 0)); },
    Bounce: function (speed) { return 232 + Math.round(23 * Math.max(Math.min(1, speed), 0)); }
}

// --- 475z Gobo Rotation ---
export const GOBO_ROTATION_475Z = {
    GoboIndexing: function (index) { return Math.round(63 * Math.max(Math.min(1, index), 0)); },
    Rotation: function (speed) { return 64 + Math.round(83 * Math.max(Math.min(1, speed), 0)); },
    ReverseRotation: function (speed) { return 148 + Math.round(83 * Math.max(Math.min(1, speed), 0)); },
    Bounce: function (speed) { return 232 + Math.round(23 * Math.max(Math.min(1, speed), 0)); }
}

// --- 375z Prism ---
export const PRISM_375Z = {
    NoFunction: 0,
    SixFaucet: 4,
    SixFaucetRotation: function (speed) { return 7 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    SixFaucetReverseRotation: function (speed) { return 66 + Math.round(57 * Math.max(Math.min(1, speed), 0)); },
    FiveFaucet: 132,
    FiveFaucetRotation: function (speed) { return 135 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    FiveFaucetReverseRotation: function (speed) { return 194 + Math.round(57 * Math.max(Math.min(1, speed), 0)); }
}

// --- 475z Prism ---
export const PRISM_475Z = {
    NoFunction: 0,
    Prism1Round: 4,
    Prism1Rotation: function (speed) { return 7 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    Prism1ReverseRotation: function (speed) { return 66 + Math.round(57 * Math.max(Math.min(1, speed), 0)); },
    Prism1Round2: 124,
    NoFunction2: 128,
    Prism2Linear: 132,
    Prism2Rotation: function (speed) { return 135 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    Prism2ReverseRotation: function (speed) { return 194 + Math.round(57 * Math.max(Math.min(1, speed), 0)); },
    Prism2Linear2: 252,
}

// --- 375z Shutter ---
export const SHUTTER_375Z = {
    Closed: 0,
    Open: 4,
    Strobe: function (speed) { return 8 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    PulseStrobe: function (speed) { return 77 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    RandomStrobe: function (speed) { return 146 + Math.round(69 * Math.max(Math.min(1, speed), 0)); }
}

// --- 475z Shutter ---
export const SHUTTER_475Z = {
    Off: 0,
    Open: 4,
    Strobe: function (speed) { return 8 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    PulseStrobe: function (speed) { return 77 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    RandomStrobe: function (speed) { return 146 + Math.round(69 * Math.max(Math.min(1, speed), 0)); },
    Open2: 216,
}

export default {
    Mover,
    COLORS,
    GOBO_375Z,
    GOBO_475Z,
    GOBO_ROTATION_375Z,
    GOBO_ROTATION_475Z,
    STATIC_GOBO_475Z,
    PRISM_375Z,
    PRISM_475Z,
    SHUTTER_375Z,
    SHUTTER_475Z,
}
