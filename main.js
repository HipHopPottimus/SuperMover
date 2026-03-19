import mover from "./mover.js";
import joystick from "./joystick.js";


const mover1 = new mover.Mover(1, process.env.debug === "true");

const joystick1 = new joystick.Joystick(0x046d, 0xc214);

joystick1.onData = () => {
    mover1.set({
        Pan: joystick1.x,
        Tilt: joystick1.y,
    });
    mover1.set({
        Dimmer: joystick1.throttle,
    });
    if (data[3]) mover1.set({ ColorWheel: Math.floor(Math.log2(data[3])) * 8 });
}

import repl from "repl";
const rl = repl.start({
    prompt: "> ",
    useColors: true,
    preview: true
});

Object.assign(rl.context, {
    mover1,
    mover
});