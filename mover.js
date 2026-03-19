/* CHANNELS (15ch personality; 1-indexed)
 * 1: Pan
 * 2: Pan Fine
 * 3: Tilt
 * 4: Tilt Fine
 * 5: Pan/Tilt Speed (0 fast, 255 slow)
 * 6: Color Wheel
 *     0-7: White
 *     8-15: Orange
 *     16-23: Lime green
 *     24-31: Cyan
 *     32-39: Red
 *     40-47: Green
 *     48-55: Magenta
 *     56-63: Yellow
 *     64: White
 *     065-189: Color indexing ???
 *     190-221: Color cycling rainbow, fast to slow
 *     222-223: Stop
 *     224-255: Reverse color cycling rainbow, slow to fast
 * 7: Gobo Wheel **SEE GOBOS.png**
 *     0-7: Open
 *     8-15: Gobo 1
 *     16-23: Gobo 2
 *     24-31: Gobo 3
 *     32-39: Gobo 4
 *     40-47: Gobo 5
 *     48-55: Gobo 6
 *     56-63: Gobo 7
 *     64-71: Gobo 7 shake, slow to fast
 *     72-79: Gobo 6 shake, slow to fast
 *     80-87: Gobo 5 shake, slow to fast
 *     88-95: Gobo 4 shake, slow to fast
 *     96-103: Gobo 3 shake, slow to fast
 *     104-111: Gobo 2 shake, slow to fast
 *     112-119: Gobo 1 shake, slow to fast
 *     120-127: Open
 *     128-189: Cycle effect, slow to fast
 *     190-193: Stop
 *     194-255: Reverse cycle effect, slow to slow
 * 8: Gobo Rotation
 *     0: No function
 *     1-63: Gobo indexing
 *     64-145: Rotation, slow to fast
 *     146-149: Stop
 *     150-231: Reverse rotation, slow to fast
 *     232-255: Bounce, slow to fast
 * 9: Prism
 *     0-3: No function
 *     4-6: 6-faucet prism
 *     7-65: 6-faucet prism rotation, slow to fast
 *     66-123: 6-faucet prism reverse rotation, slow to fast
 *     124-127: 6-faucet prism
 *     128-131: No function
 *     132-134: 5-faucet prism
 *     135-193: 5-faucet prism rotation, slow to fast
 *     194-251: 5-faucet prism reverse rotation, slow to fast
 *     252-255: 5-faucet prism
 * 10: Focus 0-100%
 * 11: Dimmer 0-100%
 * 12: Shutter
 *     0-3: Closed
 *     4-7: Open
 *     8-76: Strobe, slow to fast
 *     77-145: Pulse strobe, slow to fast
 *     146-215: Random strobe, slow to fast
 *     216-255: Open
 * 13: Function
 *     0-7: No function
 *     8-15: Blackout on P/T movement
 *     16-23: Blackout on color movement
 *     24-31: Blackout on gobo movement
 *     32-39: Blackout on P/T & color movement
 *     40-47: Blackout on P/T & gobo movement
 *     48-55: Blackout on P/T & color & gobo movement
 *     56-95: No function
 *     96-103: Pan reset
 *     104-111: Tilt reset
 *     112-119: Color reset
 *     120-127: Gobo reset
 *     128-135: No function
 *     136-143: Prism reset
 *     144-151: Focus and zoom reset
 *     152-159: All reset
 *     160-255: No function
 * 14: Movement Macros
 *     I'm tired so can't be bothered.
 * 15: Zoom narrow to wide
 */

import getDmx from "./dmx.js";

export class Mover {
    /** @type {number} Start channel */
    channel;

    /** @type {Record<number, number>} */
    channelValues = {};

    debug = false;

    constructor(channel = 1, debug = false) {
        this.channel = channel;
        this.debug = debug;

        this.reset();
    }

    get CHANNELS() {
        return {
            Pan: this.channel,
            PanFine: this.channel + 1,
            Tilt: this.channel + 2,
            TiltFine: this.channel + 3,
            PTSpeed: this.channel + 4,
            ColorWheel: this.channel + 5,
            GoboWheel: this.channel + 6,
            GoboRotation: this.channel + 7,
            Prism: this.channel + 8,
            Focus: this.channel + 9,
            Dimmer: this.channel + 10,
            Shutter: this.channel + 11,
            Function: this.channel + 12,
            MovementMacros: this.channel + 13,
            Zoom: this.channel + 14,
        }
    }

    // JS doc comments so I can get my sweet sweet type annotations. LOOKING AT YOU Mr. JAVASCRIPT ONLY!!!

    /**
     * Sets the pan angle in degrees.
     * @param {number} deg The pan angle in degrees (0 to 540)
     * @param {boolean} useFine Whether to use fine adjustment (16-bit precision). If false, only the coarse value is set (8-bit precision).
     * @returns {void}
     */
    setPanDeg(deg, useFine = false) {
        // 0 to 540deg
        const value = Math.round(deg / 540 * 65535);
        if (useFine) {
            const coarse = value >> 8 & 0xFF;
            const fine = value & 0xFF;
            this.set({ Pan: coarse, PanFine: fine });
            return;
        }
        this.set({ Pan: value >> 8 & 0xFF });
    }

    /**
     * Sets the tilt angle in degrees.
     * @param {number} deg The tilt angle in degrees (0 to 270)
     * @param {boolean} useFine Whether to use fine adjustment (16-bit precision). If false, only the coarse value is set (8-bit precision).
     * @returns {void}
     */
    setTiltDeg(deg, useFine = false) {
        // 0 to 270deg
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
     * @param {Record<keyof typeof this.CHANNELS, number>} vals An object mapping channel names to their values.
     * @returns {void}
     */
    set(vals) {
        // process.stdout.write(`\r\x1b[0;0H\x1b[2J${Object.entries(vals).map(([k, v]) => `${k}: ${v}`).join("\n")}`);
        vals = Object.fromEntries(Object.entries(vals).map(([k, v]) => [this.CHANNELS[k], v]));
        this.setChannels(vals);
    }

    /**
     * Sets the values for multiple DMX channels.
     * @param {Record<number, number>} channels An object mapping channel IDs to their values.
     */
    setChannels(channels) {
        // console.log(channels);
        if (this.debug) {
            console.log(Object.entries(channels).map(([k, v]) => `${k}: ${v}`).join("\n"));
        }
        this.channelValues = { ...this.channelValues, ...channels };
        getDmx().setChannels(channels);
    }

    reset() {
        this.set({
            Shutter: SHUTTER.Open,
            ColorWheel: COLORS.White,
            GoboWheel: GOBO.Open,
            GoboRotation: GOBO_ROTATION.NoFunction,
            Prism: PRISM.NoFunction,
            Function: 0,
            Zoom: 0,
            Focus: 0,
            Dimmer: 255,
            Pan: 0,
            PanFine: 0,
            Tilt: 0,
            TiltFine: 0,
            PTSpeed: 0,
            MovementMacros: 0,
        });
    }
}

export const COLORS = {
    White: 0,
    Orange: 8,
    LimeGreen: 16,
    Cyan: 24,
    Red: 32,
    Green: 40,
    Magenta: 48,
    Yellow: 56,
    ColorIndexing: function (index) { return 64 + index; },
    ColorCycle: function (speed) { return 190 + Math.round(31 * Math.max(Math.min(1, speed), 0)); },
    ReverseColorCycle: function (speed) { return 222 + Math.round(33 * Math.max(Math.min(1, speed), 0)); }
}

export const GOBO = {
    Open: 0,
    Gobo1: 8,
    Gobo2: 16,
    Gobo3: 24,
    Gobo4: 32,
    Gobo5: 40,
    Gobo6: 48,
    Gobo7: 56,
    Gobo7Shake: function (speed) { return 64 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo6Shake: function (speed) { return 72 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo5Shake: function (speed) { return 80 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo4Shake: function (speed) { return 88 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo3Shake: function (speed) { return 96 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo2Shake: function (speed) { return 104 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    Gobo1Shake: function (speed) { return 112 + Math.round(7 * Math.max(Math.min(1, speed), 0)); },
    CycleEffect: function (speed) { return 128 + Math.round(61 * Math.max(Math.min(1, speed), 0)); },
    CycleEffectReverse: function (speed) { return 194 + Math.round(61 * Math.max(Math.min(1, speed), 0)); }
}

export const GOBO_ROTATION = {
    NoFunction: 0,
    GoboIndexing: function (index) { return 1 + Math.round(62 * Math.max(Math.min(1, index), 0)); },
    Rotation: function (speed) { return 64 + Math.round(81 * Math.max(Math.min(1, speed), 0)); },
    Stop: 146,
    ReverseRotation: function (speed) { return 150 + Math.round(81 * Math.max(Math.min(1, speed), 0)); },
    Bounce: function (speed) { return 232 + Math.round(23 * Math.max(Math.min(1, speed), 0)); }
}

export const PRISM = {
    NoFunction: 0,
    SixFaucet: 4,
    SixFaucetRotation: function (speed) { return 7 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    SixFaucetReverseRotation: function (speed) { return 66 + Math.round(57 * Math.max(Math.min(1, speed), 0)); },
    FiveFaucet: 132,
    FiveFaucetRotation: function (speed) { return 135 + Math.round(58 * Math.max(Math.min(1, speed), 0)); },
    FiveFaucetReverseRotation: function (speed) { return 194 + Math.round(57 * Math.max(Math.min(1, speed), 0)); }
}

export const SHUTTER = {
    Closed: 0,
    Open: 4,
    Strobe: function (speed) { return 8 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    PulseStrobe: function (speed) { return 77 + Math.round(68 * Math.max(Math.min(1, speed), 0)); },
    RandomStrobe: function (speed) { return 146 + Math.round(69 * Math.max(Math.min(1, speed), 0)); }
}

export default {
    Mover,
    COLORS,
    GOBO,
    GOBO_ROTATION,
    PRISM,
    SHUTTER
};
