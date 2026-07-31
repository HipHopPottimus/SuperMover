import readline from "readline/promises";

import { stdin, stdout } from "process";

export default class DummyInput {
    /** @type {Function | undefined} */
    onUpdate;

    /** @type {number} */
    x = ((127 << 8) + 127) / 257;

    /** @type {number} */
    y = ((127 << 8) + 127) / 257;

    /** @type {number} */
    dX = 0;

    /** @type {number} */
    dY = 0;

    /** @type {number} */
    zoom = 0;

    /** @type {boolean} */
    dZ = 0;

    /** @type {number} */
    zoomVelocity = 0;

    /** @type {number} 0-255 dimmer */
    dimmer = 0;

    /** @type {number} */
    dimmerVelocity = 0;

    /** @type {number} */
    dDimmer = 0;

    name = "Dummy input";

    async start() {
        console.log("Dummy input device started");
        console.log("Enter NaN to break");
        const rl = readline.createInterface({input: stdin, output: stdout});
        while(true) {
            const dimmer = Number.parseInt(await rl.question("Dimmer (0-100): "));
            if(isNaN(dimmer)) break;
            this.dimmer = dimmer / 100 * 255;

            if(this.onUpdate) this.onUpdate();
        }

        console.log("Dummy input ended");
        rl.close();
    }


}