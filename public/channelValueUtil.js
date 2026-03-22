function spd(sliderId) {
    return parseInt(document.getElementById(sliderId).value) / 100;
}

function computeColorValue(ch) {
    const sel = document.getElementById(`${ch}-color`).value;
    const s = spd(`${ch}-color-speed`);
    if (sel.startsWith('w:')) return parseInt(sel.slice(2));
    if (sel === 'indexed') return 64 + Math.round(125 * s);
    if (sel === 'cycle') return 190 + Math.round(31 * s);
    if (sel === 'rcycle') return 222 + Math.round(33 * s);
    return 0;
}

function computeGoboValue(ch) {
    const sel = document.getElementById(`${ch}-gobo`).value;
    const s = spd(`${ch}-gobo-speed`);
    if (sel.startsWith('w:')) return parseInt(sel.slice(2));
    if (sel === 'g7shake') return 64 + Math.round(7 * s);
    if (sel === 'g6shake') return 72 + Math.round(7 * s);
    if (sel === 'g5shake') return 80 + Math.round(7 * s);
    if (sel === 'g4shake') return 88 + Math.round(7 * s);
    if (sel === 'g3shake') return 96 + Math.round(7 * s);
    if (sel === 'g2shake') return 104 + Math.round(7 * s);
    if (sel === 'g1shake') return 112 + Math.round(7 * s);
    if (sel === 'cycle') return 128 + Math.round(61 * s);
    if (sel === 'rcycle') return 194 + Math.round(61 * s);
    return 0;
}

function computeGoboRotValue(ch) {
    const sel = document.getElementById(`${ch}-gobo-rot`).value;
    const s = spd(`${ch}-gobo-rot-speed`);
    if (sel === 'nofunc') return 0;
    if (sel === 'index') return 1 + Math.round(62 * s);
    if (sel === 'fwd') return 64 + Math.round(81 * s);
    if (sel === 'stop') return 146;
    if (sel === 'rev') return 150 + Math.round(81 * s);
    if (sel === 'bounce') return 232 + Math.round(23 * s);
    return 0;
}

function computePrismValue(ch) {
    const sel = document.getElementById(`${ch}-prism`).value;
    const s = spd(`${ch}-prism-speed`);
    if (sel === 'nofunc') return 0;
    if (sel === '6faucet') return 4;
    if (sel === '6fwd') return 7 + Math.round(58 * s);
    if (sel === '6rev') return 66 + Math.round(57 * s);
    if (sel === '5faucet') return 132;
    if (sel === '5fwd') return 135 + Math.round(58 * s);
    if (sel === '5rev') return 194 + Math.round(57 * s);
    return 0;
}

function computeShutterValue(ch) {
    const sel = document.getElementById(`${ch}-shutter`).value;
    const s = spd(`${ch}-shutter-speed`);
    if (sel === 'closed') return 0;
    if (sel === 'open') return 4;
    if (sel === 'strobe') return 8 + Math.round(68 * s);
    if (sel === 'pulse') return 77 + Math.round(68 * s);
    if (sel === 'random') return 146 + Math.round(69 * s);
    return 4;
}

export default {
    spd,
    computeColorValue,
    computeGoboValue,
    computeGoboRotValue,
    computePrismValue,
    computeShutterValue
}