const socket = new WebSocket(`ws://${window.location.host}`);

socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case 'STATE': {
            for (const mover of msg.state.movers) {
                renderMover(mover.channel);
            }
            break;
        }
        case 'ERROR': {
            alert(msg.message);
            break;
        }
        default: {
            console.log("Received unknown message: ", msg);
        }
    }
};

function addMover() {
    const moverCh = parseInt(document.getElementById("moverCh").value);
    if (isNaN(moverCh) || moverCh < 1 || moverCh > 512) {
        alert("Please enter a valid channel number (1-512)");
        return;
    }
    socket.send(JSON.stringify({
        type: 'CREATE_MOVER',
        channel: moverCh
    }));
}

function renderMover(ch) {
    if (document.getElementById(`mover-${ch}`)) return;
    const template = document.getElementById('mover-template').innerHTML;
    const html = template.replace(/\{ch\}/g, ch);
    const div = document.createElement('div');
    div.innerHTML = html;
    document.querySelector('.movers').appendChild(div.firstElementChild);
    initMoverControls(ch);
}

function sendMoverSet(ch, values) {
    socket.send(JSON.stringify({ type: 'MOVER_SET', channel: ch, values }));
}

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

function initMoverControls(ch) {
    // Simple 0-255 sliders
    const sliderMap = {
        'pan': 'Pan',
        'pan-fine': 'PanFine',
        'tilt': 'Tilt',
        'tilt-fine': 'TiltFine',
        'pt-speed': 'PTSpeed',
        'focus': 'Focus',
        'dimmer': 'Dimmer',
        'zoom': 'Zoom',
    };
    for (const [id, dmxKey] of Object.entries(sliderMap)) {
        const slider = document.getElementById(`${ch}-${id}`);
        const label = document.getElementById(`${ch}-${id}-label`);
        slider.addEventListener('input', () => {
            label.textContent = slider.value;
            sendMoverSet(ch, { [dmxKey]: parseInt(slider.value) });
        });
    }

    // Color wheel
    const colorSelect = document.getElementById(`${ch}-color`);
    const colorSpeedWrap = document.getElementById(`${ch}-color-speed-wrap`);
    const colorSpeed = document.getElementById(`${ch}-color-speed`);
    const colorSpeedLbl = document.getElementById(`${ch}-color-speed-label`);
    const needsColorSpeed = () => ['indexed', 'cycle', 'rcycle'].includes(colorSelect.value);
    colorSelect.addEventListener('change', () => {
        colorSpeedWrap.classList.toggle('noSee', !needsColorSpeed());
        sendMoverSet(ch, { ColorWheel: computeColorValue(ch) });
    });
    colorSpeed.addEventListener('input', () => {
        colorSpeedLbl.textContent = colorSpeed.value + '%';
        sendMoverSet(ch, { ColorWheel: computeColorValue(ch) });
    });

    // Gobo wheel
    const goboSelect = document.getElementById(`${ch}-gobo`);
    const goboSpeedWrap = document.getElementById(`${ch}-gobo-speed-wrap`);
    const goboSpeed = document.getElementById(`${ch}-gobo-speed`);
    const goboSpeedLbl = document.getElementById(`${ch}-gobo-speed-label`);
    const needsGoboSpeed = () => !goboSelect.value.startsWith('w:');
    goboSelect.addEventListener('change', () => {
        goboSpeedWrap.classList.toggle('noSee', !needsGoboSpeed());
        sendMoverSet(ch, { GoboWheel: computeGoboValue(ch) });
    });
    goboSpeed.addEventListener('input', () => {
        goboSpeedLbl.textContent = goboSpeed.value + '%';
        sendMoverSet(ch, { GoboWheel: computeGoboValue(ch) });
    });

    // Gobo rotation
    const goboRotSelect = document.getElementById(`${ch}-gobo-rot`);
    const goboRotSpeedWrap = document.getElementById(`${ch}-gobo-rot-speed-wrap`);
    const goboRotSpeed = document.getElementById(`${ch}-gobo-rot-speed`);
    const goboRotSpeedLbl = document.getElementById(`${ch}-gobo-rot-speed-label`);
    const needsGoboRotSpeed = () => !['nofunc', 'stop'].includes(goboRotSelect.value);
    goboRotSelect.addEventListener('change', () => {
        goboRotSpeedWrap.classList.toggle('noSee', !needsGoboRotSpeed());
        sendMoverSet(ch, { GoboRotation: computeGoboRotValue(ch) });
    });
    goboRotSpeed.addEventListener('input', () => {
        goboRotSpeedLbl.textContent = goboRotSpeed.value + '%';
        sendMoverSet(ch, { GoboRotation: computeGoboRotValue(ch) });
    });

    // Prism
    const prismSelect = document.getElementById(`${ch}-prism`);
    const prismSpeedWrap = document.getElementById(`${ch}-prism-speed-wrap`);
    const prismSpeed = document.getElementById(`${ch}-prism-speed`);
    const prismSpeedLbl = document.getElementById(`${ch}-prism-speed-label`);
    const needsPrismSpeed = () => !['nofunc', '6faucet', '5faucet'].includes(prismSelect.value);
    prismSelect.addEventListener('change', () => {
        prismSpeedWrap.classList.toggle('noSee', !needsPrismSpeed());
        sendMoverSet(ch, { Prism: computePrismValue(ch) });
    });
    prismSpeed.addEventListener('input', () => {
        prismSpeedLbl.textContent = prismSpeed.value + '%';
        sendMoverSet(ch, { Prism: computePrismValue(ch) });
    });

    // Shutter
    const shutterSelect = document.getElementById(`${ch}-shutter`);
    const shutterSpeedWrap = document.getElementById(`${ch}-shutter-speed-wrap`);
    const shutterSpeed = document.getElementById(`${ch}-shutter-speed`);
    const shutterSpeedLbl = document.getElementById(`${ch}-shutter-speed-label`);
    const needsShutterSpeed = () => !['closed', 'open'].includes(shutterSelect.value);
    shutterSelect.addEventListener('change', () => {
        shutterSpeedWrap.classList.toggle('noSee', !needsShutterSpeed());
        sendMoverSet(ch, { Shutter: computeShutterValue(ch) });
    });
    shutterSpeed.addEventListener('input', () => {
        shutterSpeedLbl.textContent = shutterSpeed.value + '%';
        sendMoverSet(ch, { Shutter: computeShutterValue(ch) });
    });

    // Function
    const funcSelect = document.getElementById(`${ch}-func`);
    funcSelect.addEventListener('change', () => {
        sendMoverSet(ch, { Function: parseInt(funcSelect.value) });
    });
}
