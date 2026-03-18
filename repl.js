import mover from "./mover.js";
import repl from "repl";
import readline from "readline";

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const channel = await new Promise(res => rl.question("Enter channel: ", res));
const mov = new mover.Mover(Number.isNaN(Number(channel)) || channel.trim().length === 0 ? 1 : Number(channel), true);

console.log("Created mover on channel", Number.isNaN(Number(channel)) || channel.trim().length === 0 ? 1 : Number(channel));

rl.close();

console.log("Use `mov` to access your mover!")

const r = repl.start({
    prompt: "> ",
    useColors: true,
    preview: true
});

Object.assign(r.context, {
    mov,
    set: mov.set.bind(mov),
    setChannels: mov.setChannels.bind(mov),
});
