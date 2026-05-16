import channelValues from "./channelValueUtil.js";

const FIXTURE_PROFILES = {
    '375z': {
        name: 'Intimidator 375z',
        channelCount: 15,
        offsets: {
            Pan: 0, PanFine: 1, Tilt: 2, TiltFine: 3, PTSpeed: 4,
            ColorWheel: 5, GoboWheel: 6, GoboRotation: 7, Prism: 8,
            Focus: 9, Dimmer: 10, Shutter: 11, Function: 12, MovementMacros: 13, Zoom: 14,
        },
        hasStaticGobo: false,
    },
    '475z': {
        name: 'Intimidator 475z',
        channelCount: 16,
        offsets: {
            Pan: 0, PanFine: 1, Tilt: 2, TiltFine: 3, PTSpeed: 4,
            ColorWheel: 5, GoboWheel: 6, GoboRotation: 7, StaticGoboWheel: 8,
            Prism: 9, Focus: 10, Zoom: 11, Dimmer: 12, Shutter: 13, Function: 14, MovementMacros: 15,
        },
        hasStaticGobo: true,
    }
};

const CUE_APPLY_GROUPS = [
    { id: 'POS', label: 'POS', keys: ['Pan', 'PanFine', 'Tilt', 'TiltFine'], defaultOn: true },
    { id: 'SPD', label: 'SPD', keys: ['PTSpeed'], defaultOn: true },
    { id: 'DM', label: 'DM', keys: ['Dimmer'], defaultOn: true },
    { id: 'FZ', label: 'FZ', keys: ['Focus', 'Zoom'], defaultOn: true },
    { id: 'CO', label: 'CO', keys: ['ColorWheel'], defaultOn: true },
    { id: 'GB', label: 'GB', keys: ['GoboWheel', 'StaticGoboWheel'], defaultOn: true },
    { id: 'ROT', label: 'ROT', keys: ['GoboRotation'], defaultOn: true },
    { id: 'PS', label: 'PS', keys: ['Prism'], defaultOn: true },
    { id: 'SH', label: 'SH', keys: ['Shutter'], defaultOn: true },
    { id: 'FN', label: 'FN', keys: ['Function', 'MovementMacros'], defaultOn: false },
];

const CUE_APPLY_KEYS = new Map(CUE_APPLY_GROUPS.flatMap(group => group.keys.map(key => [key, group.id])));
const CUE_FADE_GROUPS = CUE_APPLY_GROUPS.filter(group => ["POS", "SPD", "DM", "FZ"].includes(group.id));
const CUE_VALUE_KEYS = [...new Set(CUE_APPLY_GROUPS.flatMap(group => group.keys))];
const SPECIAL_CUE_STAGE = "SPC:STG";
const SPECIAL_CUE_RESET = "SPC:RST";
const SPECIAL_CUE_NAMES = [SPECIAL_CUE_STAGE, SPECIAL_CUE_RESET];

/**
 * Gets a profile object for a mover profile, defaults to the profile for the 375z
 * @param {string} type
 */
function getProfile(type) {
    return FIXTURE_PROFILES[type] || FIXTURE_PROFILES['375z'];
}

const moverFixtureTypes = {};

export const socket = new WebSocket(`ws://${window.location.host}`);

let currentState, currentCueNumber;
let cueApplyDragState = null;
let suppressCueApplyClick = new WeakSet();
let suppressCueStorageUpdates = false;

let connectionEstablished = false;
let timeout = setTimeout(() => {
    if (connectionEstablished || socket.readyState === WebSocket.OPEN) return;
    document.body.innerHTML = `<h1>Connection timeout</h1><p>The server did not respond in time. Please refresh the page.</p><p>Socket: ${escapeHtml(socket.url)} (${socket.readyState})</p>`;
}, 15000);

function markSocketConnected() {
    connectionEstablished = true;
    clearTimeout(timeout);
}

socket.onopen = () => {
    markSocketConnected();
    console.log("WebSocket connection established");
}

socket.onmessage = (event) => {
    markSocketConnected();
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case 'STATE': {
            const oldState = currentState;
            currentState = msg.state;
            if (oldState?.movers?.length != msg.state.movers.length) renderCues();

            for (const mover of msg.state.movers) renderMover(mover);

            break;
        }
        case 'ERROR': {
            alert(msg.message);
            break;
        }
        case "GOTO_CUE_NUMBER":
        case "CUE_STATE": {
            applyCueStackState(msg.cueNumber);
            break;
        }
        case "CUE_STORAGE_STATE": {
            if (cueApplyDragState) break;

            cueStorage = deepProxy(msg.cueStorage, onStorageUpdate);
            renderCues();
            applyCueStackState(currentCueNumber, 0);
            refreshCueEditorFromStorage();
            break;
        }
        default: {
            console.log("Received unknown message: ", msg);
        }
    }
}

socket.onerror = (err) => {
    console.error("WebSocket error: ", err, "please refresh the page.");
    document.body.innerHTML = "<h1>Connection error: " + err.message + "</h1><p>Please refresh the page.</p>";
}

socket.onclose = () => {
    document.body.innerHTML = "<h1>Connection closed</h1><p>Please refresh the page.</p>";
}

/**
 * Updates the style property --range-value for a slider- used for styling slider vertically
 * @param {Element} slider the slider element
 */
function updateRangeFill(slider) {
    if (!slider) return;
    const min = Number(slider.min || 0);
    const max = Number(slider.max || 100);
    const value = Number(slider.value);
    const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
    slider.style.setProperty('--range-value', `${percent}%`);
}

/**
 * Sends a socket message to add a mover based on the values in the add mover form
 */
function addMover() {
    const moverCh = parseInt(document.getElementById("moverCh").value);
    const fixtureType = document.getElementById("moverType").value;
    if (isNaN(moverCh) || moverCh < 1 || moverCh > 512) {
        alert("Please enter a valid channel number (1-512)");
        return;
    }
    socket.send(JSON.stringify({
        type: 'CREATE_MOVER',
        channel: moverCh,
        fixtureType: fixtureType
    }));
}

/**
 * Renders the html for a mover block
 * @param {*} mover mover object
 */
function renderMover(mover) {
    const ch = mover.channel;
    const fixtureType = mover.fixtureType || '375z';
    moverFixtureTypes[ch] = fixtureType;
    const profile = getProfile(fixtureType);

    if (!document.getElementById(`mover-${ch}`)) {
        const template = document.getElementById('mover-template').innerHTML;
        let html = template.replace(/\{ch\}/g, ch);
        html = html.replace(/\{type\}/g, profile.name);
        const div = document.createElement('div');
        div.innerHTML = html;

        if (profile.hasStaticGobo) {
            const selectsDiv = div.querySelector('.mover-selects');
            const staticGoboBlock = document.createElement('div');
            staticGoboBlock.className = 'mover-input-block';
            staticGoboBlock.innerHTML = `
                <label for="${ch}-static-gobo">Static Gobo:</label>
                <select id="${ch}-static-gobo">
                    <option value="w:0">Open</option>
                    <option value="w:7">Gobo 1</option>
                    <option value="w:14">Gobo 2</option>
                    <option value="w:21">Gobo 3</option>
                    <option value="w:28">Gobo 4</option>
                    <option value="w:35">Gobo 5</option>
                    <option value="w:42">Gobo 6</option>
                    <option value="w:49">Gobo 7</option>
                    <option value="w:56">Gobo 8</option>
                    <option value="g8shake">Gobo 8 Shake</option>
                    <option value="g7shake">Gobo 7 Shake</option>
                    <option value="g6shake">Gobo 6 Shake</option>
                    <option value="g5shake">Gobo 5 Shake</option>
                    <option value="g4shake">Gobo 4 Shake</option>
                    <option value="g3shake">Gobo 3 Shake</option>
                    <option value="g2shake">Gobo 2 Shake</option>
                    <option value="g1shake">Gobo 1 Shake</option>
                    <option value="rcycle">Reverse Cycle</option>
                    <option value="cycle">Cycle Effect</option>
                </select>
                <span id="${ch}-static-gobo-speed-wrap" class="noSee">
                    <label for="${ch}-static-gobo-speed">Speed:</label>
                    <input type="range" min="0" max="100" value="0" id="${ch}-static-gobo-speed">
                    <span id="${ch}-static-gobo-speed-label">0%</span>
                </span>
            `;
            const forgetBtn = selectsDiv.querySelector(`#forget-${ch}`);
            selectsDiv.insertBefore(staticGoboBlock, forgetBtn);
        }

        document.querySelector('.movers').appendChild(div.firstElementChild);
        initMoverControls(ch, fixtureType);
    }
    fillMoverFromChannelValues(ch, mover.channelValues, fixtureType);
}

/**
 * Sets the value of a mover property slider
 * @param {number} ch  mover channel
 * @param {string} id id of the property (e.g. pan-fine, zoom)
 * @param {number} val value to set (0-255)
 * @returns 
 */
function setSlider(ch, id, val) {
    console.log("called with ", ch, id, val);
    const el = document.getElementById(`${ch}-${id}`);
    if (!el) return;
    el.value = val;
    updateRangeFill(el);
    const labelEl = document.getElementById(`${ch}-${id}-label`);
    if (!labelEl) return;
    switch (id) {
        case 'zoom': {
            const ft = moverFixtureTypes[ch] || '375z';
            const wide = ft === '475z' ? 13 : 10;
            const narrow = 28;
            let deg = wide + (narrow - wide) * (val / 255);
            labelEl.textContent = deg.toFixed(1) + '\u00B0';
            break;
        }
        case 'pt-speed':
            let pct = 100 - Math.round(val / 255 * 100);
            labelEl.textContent = pct + '%';
            break;
        case 'dimmer':
            labelEl.textContent = (val / 2.55).toFixed(1) + '%';
            break;
        case 'pan':
            let panDeg = 540 * (val / 255) - 270;
            labelEl.textContent = panDeg.toFixed(0) + '\u00B0';
            break;
        case 'tilt':
            let tiltDeg = 270 * (val / 255) - 135;
            labelEl.textContent = tiltDeg.toFixed(0) + '\u00B0';
            break;
        default:
            labelEl.textContent = val;
    }
}

/**
 * Sets the speed of a mover property
 * @param {*} ch the channel number
 * @param {*} suffix value to use in class names
 * @param {number} spd decimal value of the speed to set (0-1)
 */
function setSelectSpeed(ch, suffix, sel, spd) {
    const el = document.getElementById(`${ch}-${suffix}`);
    if (!el) return;
    el.value = sel;
    const wrap = document.getElementById(`${ch}-${suffix}-speed-wrap`);
    if (spd !== undefined) {
        const pct = Math.round(spd * 100);
        const spdEl = document.getElementById(`${ch}-${suffix}-speed`);
        if (spdEl) {
            spdEl.value = pct;
            updateRangeFill(spdEl);
        }
        const lbl = document.getElementById(`${ch}-${suffix}-speed-label`);
        if (lbl) lbl.textContent = pct + '%';
        if (wrap) wrap.classList.remove('noSee');
    } else {
        if (wrap) wrap.classList.add('noSee');
    }
}

/**
 * Fills a mover UI with channel values
 * @param {number} ch the mover channel number
 * @param {*} cv the channel values to set in an object that associates dmx addresses (indexed from 0 relative to the) to values from 0-255
 * @param {string} fixtureType the type of fixture to fill 
 */
function fillMoverFromChannelValues(ch, cv, fixtureType) {
    if (!cv) return;
    const profile = getProfile(fixtureType);
    const off = profile.offsets;

    const simpleSliders = [
        ['pan', off.Pan],
        ['pan-fine', off.PanFine],
        ['tilt', off.Tilt],
        ['tilt-fine', off.TiltFine],
        ['pt-speed', off.PTSpeed],
        ['focus', off.Focus],
        ['dimmer', off.Dimmer],
        ['zoom', off.Zoom],
    ];
    for (const [id, abs] of simpleSliders) {
        if (cv[ch + abs] !== undefined) setSlider(ch, id, cv[ch + abs]);
    }

    const col = cv[ch + off.ColorWheel];
    if (col !== undefined) {
        if (col < 64) setSelectSpeed(ch, 'color', `w:${Math.floor(col / 8) * 8}`);
        else if (col <= 189) setSelectSpeed(ch, 'color', 'indexed', (col - 64) / 125);
        else if (col <= 221) setSelectSpeed(ch, 'color', 'cycle', (col - 190) / 31);
        else setSelectSpeed(ch, 'color', 'rcycle', (col - 222) / 33);
    }

    const gob = cv[ch + off.GoboWheel];
    if (gob !== undefined) {
        if (gob < 64) setSelectSpeed(ch, 'gobo', `w:${Math.floor(gob / 8) * 8}`);
        else if (gob <= 71) setSelectSpeed(ch, 'gobo', 'g7shake', (gob - 64) / 7);
        else if (gob <= 79) setSelectSpeed(ch, 'gobo', 'g6shake', (gob - 72) / 7);
        else if (gob <= 87) setSelectSpeed(ch, 'gobo', 'g5shake', (gob - 80) / 7);
        else if (gob <= 95) setSelectSpeed(ch, 'gobo', 'g4shake', (gob - 88) / 7);
        else if (gob <= 103) setSelectSpeed(ch, 'gobo', 'g3shake', (gob - 96) / 7);
        else if (gob <= 111) setSelectSpeed(ch, 'gobo', 'g2shake', (gob - 104) / 7);
        else if (gob <= 119) setSelectSpeed(ch, 'gobo', 'g1shake', (gob - 112) / 7);
        else if (gob <= 127) setSelectSpeed(ch, 'gobo', 'w:0');
        else if (gob <= 191) setSelectSpeed(ch, 'gobo', 'cycle', (gob - 128) / 63);
        else setSelectSpeed(ch, 'gobo', 'rcycle', (gob - 192) / 63);
    }

    const rot = cv[ch + off.GoboRotation];
    if (rot !== undefined) {
        if (rot === 0) setSelectSpeed(ch, 'gobo-rot', 'nofunc');
        else if (rot <= 63) setSelectSpeed(ch, 'gobo-rot', 'index', rot / 63);
        else if (rot <= 147) setSelectSpeed(ch, 'gobo-rot', 'fwd', (rot - 64) / 83);
        else if (rot <= 149) setSelectSpeed(ch, 'gobo-rot', 'stop');
        else if (rot <= 231) setSelectSpeed(ch, 'gobo-rot', 'rev', (rot - 148) / 83);
        else setSelectSpeed(ch, 'gobo-rot', 'bounce', (rot - 232) / 23);
    }

    if (profile.hasStaticGobo && off.StaticGoboWheel !== undefined) {
        const sg = cv[ch + off.StaticGoboWheel];
        if (sg !== undefined) {
            if (sg < 7) setSelectSpeed(ch, 'static-gobo', 'w:0');
            else if (sg <= 63) setSelectSpeed(ch, 'static-gobo', `w:${Math.floor((sg - 1) / 7) * 7 + 7}`);
            else if (sg <= 71) setSelectSpeed(ch, 'static-gobo', 'g8shake', (sg - 64) / 7);
            else if (sg <= 78) setSelectSpeed(ch, 'static-gobo', 'g7shake', (sg - 72) / 6);
            else if (sg <= 85) setSelectSpeed(ch, 'static-gobo', 'g6shake', (sg - 79) / 6);
            else if (sg <= 92) setSelectSpeed(ch, 'static-gobo', 'g5shake', (sg - 86) / 6);
            else if (sg <= 99) setSelectSpeed(ch, 'static-gobo', 'g4shake', (sg - 93) / 6);
            else if (sg <= 106) setSelectSpeed(ch, 'static-gobo', 'g3shake', (sg - 100) / 6);
            else if (sg <= 113) setSelectSpeed(ch, 'static-gobo', 'g2shake', (sg - 107) / 6);
            else if (sg <= 120) setSelectSpeed(ch, 'static-gobo', 'g1shake', (sg - 114) / 6);
            else if (sg <= 127) setSelectSpeed(ch, 'static-gobo', 'w:0');
            else if (sg <= 191) setSelectSpeed(ch, 'static-gobo', 'rcycle', (sg - 128) / 63);
            else setSelectSpeed(ch, 'static-gobo', 'cycle', (sg - 192) / 63);
        }
    }

    const pri = cv[ch + off.Prism];
    if (pri !== undefined) {
        if (pri < 4) setSelectSpeed(ch, 'prism', 'nofunc');
        else if (pri <= 6) setSelectSpeed(ch, 'prism', '6faucet');
        else if (pri <= 65) setSelectSpeed(ch, 'prism', '6fwd', (pri - 7) / 58);
        else if (pri <= 123) setSelectSpeed(ch, 'prism', '6rev', (pri - 66) / 57);
        else if (pri <= 127) setSelectSpeed(ch, 'prism', '6faucet');
        else if (pri <= 131) setSelectSpeed(ch, 'prism', 'nofunc');
        else if (pri <= 134) setSelectSpeed(ch, 'prism', '5faucet');
        else if (pri <= 193) setSelectSpeed(ch, 'prism', '5fwd', (pri - 135) / 58);
        else if (pri <= 251) setSelectSpeed(ch, 'prism', '5rev', (pri - 194) / 57);
        else setSelectSpeed(ch, 'prism', '5faucet');
    }

    const shu = cv[ch + off.Shutter];
    if (shu !== undefined) {
        if (shu < 4) setSelectSpeed(ch, 'shutter', 'closed');
        else if (shu < 8) setSelectSpeed(ch, 'shutter', 'open');
        else if (shu <= 76) setSelectSpeed(ch, 'shutter', 'strobe', (shu - 8) / 68);
        else if (shu <= 145) setSelectSpeed(ch, 'shutter', 'pulse', (shu - 77) / 68);
        else if (shu <= 215) setSelectSpeed(ch, 'shutter', 'random', (shu - 146) / 69);
        else setSelectSpeed(ch, 'shutter', 'open');
    }

    const fn = cv[ch + off.Function];
    if (fn !== undefined) {
        document.getElementById(`${ch}-func`).value = String(fn);
    }
}

function sendMoverSet(ch, values) {
    socket.send(JSON.stringify({ type: 'MOVER_SET', channel: ch, values }));
}

function initMoverControls(ch, fixtureType, options = {}) {
    const profile = getProfile(fixtureType);
    const emitMoverSet = options.onSet || ((values) => sendMoverSet(ch, values));

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
        if (!slider) continue;
        updateRangeFill(slider);
        slider.addEventListener('input', () => {
            updateRangeFill(slider);
            switch (id) {
                case 'zoom':
                    let deg = 28 + (10 - 28) * (slider.value / 255);
                    label.textContent = deg.toFixed(1) + '\u00B0';
                    break;
                case 'pt-speed':
                    let pct = 100 - Math.round(slider.value / 255 * 100);
                    label.textContent = pct + '%';
                    break;
                case 'dimmer':
                    label.textContent = (slider.value / 2.55).toFixed(1) + '%';
                    break;
                case 'pan':
                    let panDeg = 540 * (slider.value / 255) - 270;
                    label.textContent = panDeg.toFixed(0) + '\u00B0';
                    break;
                case 'tilt':
                    let tiltDeg = 270 * (slider.value / 255) - 135;
                    label.textContent = tiltDeg.toFixed(0) + '\u00B0';
                    break;
                default:
                    label.textContent = slider.value;
            }
            emitMoverSet({ [dmxKey]: parseInt(slider.value) });
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
        emitMoverSet({ ColorWheel: channelValues.computeColorValue(ch) });
    });
    colorSpeed.addEventListener('input', () => {
        updateRangeFill(colorSpeed);
        colorSpeedLbl.textContent = colorSpeed.value + '%';
        emitMoverSet({ ColorWheel: channelValues.computeColorValue(ch) });
    });

    // Gobo wheel
    const goboSelect = document.getElementById(`${ch}-gobo`);
    const goboSpeedWrap = document.getElementById(`${ch}-gobo-speed-wrap`);
    const goboSpeed = document.getElementById(`${ch}-gobo-speed`);
    const goboSpeedLbl = document.getElementById(`${ch}-gobo-speed-label`);
    const needsGoboSpeed = () => !goboSelect.value.startsWith('w:');
    goboSelect.addEventListener('change', () => {
        goboSpeedWrap.classList.toggle('noSee', !needsGoboSpeed());
        emitMoverSet({ GoboWheel: channelValues.computeGoboValue(ch, fixtureType) });
    });
    goboSpeed.addEventListener('input', () => {
        updateRangeFill(goboSpeed);
        goboSpeedLbl.textContent = goboSpeed.value + '%';
        emitMoverSet({ GoboWheel: channelValues.computeGoboValue(ch, fixtureType) });
    });

    // Gobo rotation
    const goboRotSelect = document.getElementById(`${ch}-gobo-rot`);
    const goboRotSpeedWrap = document.getElementById(`${ch}-gobo-rot-speed-wrap`);
    const goboRotSpeed = document.getElementById(`${ch}-gobo-rot-speed`);
    const goboRotSpeedLbl = document.getElementById(`${ch}-gobo-rot-speed-label`);
    const needsGoboRotSpeed = () => !['nofunc', 'stop'].includes(goboRotSelect.value);
    goboRotSelect.addEventListener('change', () => {
        goboRotSpeedWrap.classList.toggle('noSee', !needsGoboRotSpeed());
        emitMoverSet({ GoboRotation: channelValues.computeGoboRotValue(ch, fixtureType) });
    });
    goboRotSpeed.addEventListener('input', () => {
        updateRangeFill(goboRotSpeed);
        goboRotSpeedLbl.textContent = goboRotSpeed.value + '%';
        emitMoverSet({ GoboRotation: channelValues.computeGoboRotValue(ch, fixtureType) });
    });

    // Static gobo (475z only)
    if (profile.hasStaticGobo) {
        const sgSelect = document.getElementById(`${ch}-static-gobo`);
        const sgSpeedWrap = document.getElementById(`${ch}-static-gobo-speed-wrap`);
        const sgSpeed = document.getElementById(`${ch}-static-gobo-speed`);
        const sgSpeedLbl = document.getElementById(`${ch}-static-gobo-speed-label`);
        if (sgSelect) {
            const needsSGSpeed = () => !sgSelect.value.startsWith('w:');
            sgSelect.addEventListener('change', () => {
                sgSpeedWrap.classList.toggle('noSee', !needsSGSpeed());
                emitMoverSet({ StaticGoboWheel: channelValues.computeStaticGoboValue(ch) });
            });
            sgSpeed.addEventListener('input', () => {
                updateRangeFill(sgSpeed);
                sgSpeedLbl.textContent = sgSpeed.value + '%';
                emitMoverSet({ StaticGoboWheel: channelValues.computeStaticGoboValue(ch) });
            });
        }
    }

    // Prism
    const prismSelect = document.getElementById(`${ch}-prism`);
    const prismSpeedWrap = document.getElementById(`${ch}-prism-speed-wrap`);
    const prismSpeed = document.getElementById(`${ch}-prism-speed`);
    const prismSpeedLbl = document.getElementById(`${ch}-prism-speed-label`);
    const staticPrismVals = ['nofunc', '6faucet', '5faucet'];
    const needsPrismSpeed = () => !staticPrismVals.includes(prismSelect.value);
    prismSelect.addEventListener('change', () => {
        prismSpeedWrap.classList.toggle('noSee', !needsPrismSpeed());
        emitMoverSet({ Prism: channelValues.computePrismValue(ch) });
    });
    prismSpeed.addEventListener('input', () => {
        updateRangeFill(prismSpeed);
        prismSpeedLbl.textContent = prismSpeed.value + '%';
        emitMoverSet({ Prism: channelValues.computePrismValue(ch) });
    });

    // Shutter
    const shutterSelect = document.getElementById(`${ch}-shutter`);
    const shutterSpeedWrap = document.getElementById(`${ch}-shutter-speed-wrap`);
    const shutterSpeed = document.getElementById(`${ch}-shutter-speed`);
    const shutterSpeedLbl = document.getElementById(`${ch}-shutter-speed-label`);
    const needsShutterSpeed = () => !['closed', 'open'].includes(shutterSelect.value);
    shutterSelect.addEventListener('change', () => {
        shutterSpeedWrap.classList.toggle('noSee', !needsShutterSpeed());
        emitMoverSet({ Shutter: channelValues.computeShutterValue(ch) });
    });
    shutterSpeed.addEventListener('input', () => {
        updateRangeFill(shutterSpeed);
        shutterSpeedLbl.textContent = shutterSpeed.value + '%';
        emitMoverSet({ Shutter: channelValues.computeShutterValue(ch) });
    });

    // Function
    const funcSelect = document.getElementById(`${ch}-func`);
    funcSelect.addEventListener('change', () => {
        emitMoverSet({ Function: parseInt(funcSelect.value) });
    });

    // Forget mover
    const forgetButton = document.getElementById(`forget-${ch}`);
    if (options.onForget) {
        forgetButton.textContent = options.forgetLabel || "Close";
        forgetButton.addEventListener("click", options.onForget);
        return;
    }

    forgetButton.addEventListener("click", () => {
        socket.send(JSON.stringify({
            type: 'FORGET_MOVER',
            channel: ch
        }));
        document.getElementById(`mover-${ch}`).remove();
        delete moverFixtureTypes[ch];
    });
}

let unproxiedStorage = {};

/**
 * Creates a proxy for an object that is also applied to all nested objects and arrays
 * @param {*} target the object to target
 * @param {*} callback called when the object is modified
 * @param {({target, property, type, propChain}) => {}} propChain used recursively to build the chain of properties accessed
 * @returns 
 */
function deepProxy(target, callback, propChain = []) {
    const handler = {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);

            if (value !== null && typeof value === 'object') return deepProxy(value, callback, [...propChain, property]);

            return value;
        },

        set(target, property, value, receiver) {
            const oldValue = target[property];
            const result = Reflect.set(target, property, value, receiver);

            if (oldValue != value) {
                callback({
                    property,
                    oldValue,
                    newValue: value,
                    target,
                    propChain
                });
            }

            return result;
        },

        deleteProperty(target, property) {
            const oldValue = target[property];
            const result = Reflect.deleteProperty(target, property);
            if (result) callback({target, property, oldValue, type: "delete", propChain});
            return result;
        }
    };

    return new Proxy(target, handler);
}

let cueStorage;

/**
 * Highlights the cue number in the cue stack
 * @param {*} cueNumber the cue number to highlight
 * @param {*} [transitionMs] optional- the transition time in milliseconds. Defaults to the max fade time defined in the cue stack entry
 * @returns 
 */
function applyCueStackState(cueNumber, transitionMs) {
    currentCueNumber = cueNumber ? cueNumber.toString() : null;

    const cue = currentCueNumber && cueStorage?.cueStack?.[currentCueNumber];
    const fadeTime = transitionMs ?? (cue ? getCueMaxFadeTime(cue) * 1000 : 500);

    document.querySelectorAll(".cue-stack-table p").forEach(r => {
        r.style.transition = `background-color ${fadeTime}ms`;
        r.classList.remove("cue-stack-active");
    });

    if (!cue) return;

    document.querySelectorAll(`
        .cue-stack-table-${escapeCueName(currentCueNumber)},
        #cue-stack-fade-time-${escapeCueName(currentCueNumber)},
        #cue-stack-number-${escapeCueName(currentCueNumber)},
        #cue-stack-go-${escapeCueName(currentCueNumber)},
        #cue-stack-delete-${escapeCueName(currentCueNumber)}`
    ).forEach(r => {
        r.style.transition = `background-color ${fadeTime}ms`;
        r.classList.add("cue-stack-active");
    });
}

/**
 * Handler for the proxy on cue storage
 */
function onStorageUpdate(change) {
    if (suppressCueStorageUpdates) return;

    if (change.property === "cues") change.type = "replace";
    if (change.type !== "delete" && change.propChain?.[0] === "cues") change.type = "replace";

    sendCueStorageUpdate(change);
}

/**
 * Sends a cue storage update socket message to the server along with the client side stage of cue storage
 * @param {string} change a string describing the change
 */
function sendCueStorageUpdate(change) {
    socket.send(JSON.stringify({
        type: 'CUE_STORAGE_UPDATE',
        cueStorage: cueStorage,
        change
    }));
}

/**
 * Gets the fade time of a apply property of a cue stack entry
 * @param {*} cueStackEntry the cue stack entry to check the fade time of
 * @param {*} groupId the apply property id to get the fade time for
 */
function getCueFadeTime(cueStackEntry, groupId) {
    if (cueStackEntry?.special === "stage" || Object.values(cueStackEntry?.movers || {}).includes(SPECIAL_CUE_STAGE)) return 0;

    const groupFade = Number.parseFloat(cueStackEntry?.fadeTimes?.[groupId]);
    if (!Number.isNaN(groupFade)) return groupFade;

    const defaultFade = Number.parseFloat(cueStackEntry?.fadeTime);
    return Number.isNaN(defaultFade) ? 0 : defaultFade;
}

/**
 * Sets the fade times for a property group of a cue stack entry
 * @param {*} cueNumber the cue number to set the fade time for
 * @param {*} groupId the id of the property group
 * @param {*} value the fade time to set
 */
function setCueFadeTime(cueNumber, groupId, value) {
    const fadeTime = Math.max(0, Number.parseFloat(value));
    console.log(fadeTime);
    if (Number.isNaN(fadeTime)) return false;

    if (!cueStorage.cueStack[cueNumber].fadeTimes) cueStorage.cueStack[cueNumber].fadeTimes = {};
    cueStorage.cueStack[cueNumber].fadeTimes[groupId] = fadeTime;
    return true;
}

/**
 * Returns a summery of the fade time for a cue stack entry (e.g. 0.5s or 2s-3s)
 * @param {*} cueStackEntry the entry object to get a summery for
 */
function getCueFadeSummary(cueStackEntry) {
    const values = CUE_FADE_GROUPS
        .filter(group => cueStackAppliesGroup(cueStackEntry, group.id))
        .map(group => getCueFadeTime(cueStackEntry, group.id));
    const uniqueValues = [...new Set(values.map(value => value.toString()))];
    if (!uniqueValues.length) return "Fade...";
    if (uniqueValues.length === 1) return `${uniqueValues[0]}s`;
    return `${Math.min(...values)}-${Math.max(...values)}s`;
}

/**
 * Gets the maximum fade time for a cue stack entry
 * @param {*} cueStackEntry the entry object to get the max fade time for
 */
function getCueMaxFadeTime(cueStackEntry) {
    const values = CUE_FADE_GROUPS
        .filter(group => cueStackAppliesGroup(cueStackEntry, group.id))
        .map(group => getCueFadeTime(cueStackEntry, group.id));
    return Math.max(...values, 0);
}

/**
 * Checks if a cue stack entry applies a set of properties
 * @param {*} cueStackEntry the cue stack object
 * @param {*} groupId the id of the property group to check
 * @returns 
 */
function cueStackAppliesGroup(cueStackEntry, groupId) {
    return Object.values(cueStackEntry?.movers || {}).some(cueName => {
        const cue = cueStorage.cues[cueName];
        return cue && getCueApplyState(cue)[groupId];
    });
}

/**
 * Return an empty string if the fade times for apply properties at a cue number are different, or the fade time if they're all the same
 * Used for setting the value of the apply all input in the fade time matrix
 * @param {*} cueStackEntry a cue stack entry object to check
 */
function getCueFadeApplyAllValue(cueStackEntry) {
    const values = CUE_FADE_GROUPS
        .filter(group => cueStackAppliesGroup(cueStackEntry, group.id))
        .map(group => getCueFadeTime(cueStackEntry, group.id));
    if (!values.length) return "";
    return values.every(value => value === values[0]) ? values[0] : "";
}

/**
 * Sets the fade times for all apply properties of a set of cues in the cue stack
 * @param {*} cueNumber the cue number to set fade times for
 * @param {number} value the value to set the fade times to
 */
function setAllCueFadeTimes(cueNumber, value) {
    const fadeTime = Math.max(0, Number.parseFloat(value));
    if (Number.isNaN(fadeTime)) return false;

    const cue = cueStorage.cueStack[cueNumber];
    cue.fadeTime = fadeTime;
    if (!cue.fadeTimes) cue.fadeTimes = {};
    for (const group of CUE_FADE_GROUPS) {
        if (cueStackAppliesGroup(cue, group.id)) cue.fadeTimes[group.id] = fadeTime;
    }
    return true;
}

/**
 * Applies a check to a cue apply checkbox and updates the state of the element and cueStorage
 * @param {Element} cb the checkbox element 
 * @param {Boolean} checked the state of the checkbox; 
 */
function setCueApplyCheckbox(cb, checked) {
    const cueName = cb.getAttribute("data-cue-name");
    const groupId = cb.getAttribute("data-group");
    if (!cueName || !groupId || !cueStorage.cues[cueName] || cb.disabled) return;

    suppressCueStorageUpdates = true;
    try {
        cueStorage.cues[cueName].apply = getCueApplyState(cueStorage.cues[cueName]);
        cueStorage.cues[cueName].apply[groupId] = checked;
        delete cueStorage.cues[cueName].mode;
    }
    finally {
        suppressCueStorageUpdates = false;
    }
    cb.checked = checked;
}

/**
 * Applies click listeners to a list of cue apply checkboxes
 * @param {Element[]} checkboxes a list of checkbox elements to apply
 */
function setupCueApplyDrag(checkboxes) {
    for (const cb of checkboxes) {
        cb.addEventListener("pointerdown", e => {
            if (e.button !== 0 || cb.disabled) return;

            e.preventDefault();
            cueApplyDragState = {
                checked: !cb.checked,
                touched: new WeakSet(),
            };
            suppressCueApplyClick.add(cb);
            setCueApplyCheckbox(cb, cueApplyDragState.checked);
            cueApplyDragState.touched.add(cb);
        });

        cb.addEventListener("pointerenter", () => {
            if (!cueApplyDragState || cueApplyDragState.touched.has(cb)) return;

            setCueApplyCheckbox(cb, cueApplyDragState.checked);
            cueApplyDragState.touched.add(cb);
        });

        cb.addEventListener("click", e => {
            if (suppressCueApplyClick.has(cb)) {
                e.preventDefault();
                suppressCueApplyClick.delete(cb);
                return;
            }

            setCueApplyCheckbox(cb, e.target.checked);
            sendCueStorageUpdate({
                type: "replace",
                propChain: ["cues"],
                property: cb.getAttribute("data-cue-name")
            });
        });
    }
}

window.addEventListener("pointerup", () => {
    if (!cueApplyDragState) return;

    cueApplyDragState = null;
    sendCueStorageUpdate({
        type: "replace",
        property: "cues"
    });
});

/**
 * Copies a mover's state to a cue
 * @param {*} cueName the name of the cue to copy to
 * @param {*} ch the mover channel to copy from
 * @returns 
 */
async function setCue(cueName, ch) {
    const mover = currentState.movers.filter(m => m.channel == ch)[0];
    if (!mover) return;

    const cueState = mover.channelValues;
    const existingCue = cueStorage.cues[cueName];
    cueStorage.cues[cueName] = {
        ...cueState,
        apply: existingCue ? getCueApplyState(existingCue) : getDefaultCueApplyState(),
    };
    await renderCues();
}

/**
 * Reorders a cue and moves it to an index
 * @param {*} cueName the name of the cue
 * @param {*} targetIndex the index to move the cue to  
 */
function moveSavedCueToIndex(cueName, targetIndex) {
    if (isSpecialCueName(cueName) || targetIndex < SPECIAL_CUE_NAMES.length) return;

    const cueNames = Object.keys(cueStorage.cues);
    const currentIndex = cueNames.indexOf(cueName);

    if (currentIndex === -1 || targetIndex < 0 || targetIndex > cueNames.length) return;

    cueNames.splice(currentIndex, 1);
    const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
    cueNames.splice(Math.max(insertIndex, SPECIAL_CUE_NAMES.length), 0, cueName);

    cueStorage.cues = Object.fromEntries(cueNames.map(name => [name, cueStorage.cues[name]]));
    renderCues();
}

/**
 * Fills cue-stack-container with the cue stack table
 */
async function generateCueStackTable() {
    const cueStackContainer = document.getElementById("cue-stack-container");
    cueStackContainer.innerHTML = `
        <p class="cue-section-header">Cue stack <button type="button" id="cue-stack-fade-matrix-open">Fade matrix</button></p>
        <div id="cue-stack-table" class="cue-stack-table"></div>
    `;
    
    if(!Object.entries(cueStorage.cueStack).length) {
        cueStackContainer.innerHTML += `<p class="empty-message">No cues saved in cue stack</p>`;
    }

    const cueStackTable = document.getElementById("cue-stack-table");

    cueStackTable.style.gridTemplateColumns  = `repeat(${currentState.movers.length + 4}, max-content)`;

    cueStackTable.innerHTML += `<p class="cue-table-header">Cue number</p>
        ${currentState.movers.map(m => `<p class="cue-table-header">Mover #${m.channel}</p>`).join("")}
        <p class="cue-table-header">Fade</p>
        <p class="cue-table-header">Go</p>
        <p class="cue-table-header">Delete</p>
    `;

    for(const [cueNumber, cue] of Object.entries(cueStorage.cueStack).sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]))) {
        cueStackTable.innerHTML += `
            <p contenteditable id="cue-stack-number-${escapeCueName(cueNumber)}">${cueNumber}</p>
            ${currentState.movers.map(m =>
                `<p class="cue-stack-cue cue-stack-table-${escapeCueName(cueNumber)}" data-channel="${m.channel}" data-cue-number="${cueNumber}" title="Ctrl+click to clear">${cue.movers?.[m.channel] || ""}</p>`
            ).join("")}
            <p class="cue-stack-fade-time" id="cue-stack-fade-time-${escapeCueName(cueNumber)}" title="Open fade matrix">${getCueFadeSummary(cue)}</p>
            <p class="cue-stack-go" id="cue-stack-go-${escapeCueName(cueNumber)}" title="Go to cue ${cueNumber}">Go</p>
            <p id="cue-stack-delete-${escapeCueName(cueNumber)}"><img src="imgs/bin.svg" width="15"/></p>
        `;
    }

    cueStackTable.innerHTML += `<p class="cue-stack-add-header">Add a cue</p>` + currentState.movers.map(m => `<p class="cue-stack-add" data-channel="${m.channel}">+</p>`).join("") + `
        <p class="cue-stack-add-header"></p>
        <p class="cue-stack-add-header"></p>
        <p class="cue-stack-add-header"></p>
    `;

    document.getElementById("cue-stack-fade-matrix-open")?.addEventListener("click", openFadeMatrix);

    //apply listeners now that table construction is done
    for(const [cueNumber, cue] of Object.entries(cueStorage.cueStack)) {
        const cueNumberCell = document.getElementById(`cue-stack-number-${escapeCueName(cueNumber)}`);
        cueNumberCell.addEventListener("keydown", e => {
            if (e.key !== "Enter") return;

            e.preventDefault();
            e.target.blur();
        });

        cueNumberCell.addEventListener("blur", async e => {
            const newCueNumber = Number.parseFloat(e.target.textContent);
            if(isNaN(newCueNumber) || !newCueNumber) {
                rejectCueNumberEdit(e.target, cueNumber);
                return;
            }

            if(cueNumber == newCueNumber) return;

            if(cueStorage.cueStack[newCueNumber]) {
                rejectCueNumberEdit(e.target, cueNumber);
                return;
            }

            cueStorage.cueStack[newCueNumber] = cueStorage.cueStack[cueNumber];

            delete cueStorage.cueStack[cueNumber];
            renderCues();
        });
        
        document.getElementById(`cue-stack-delete-${escapeCueName(cueNumber)}`).addEventListener("click", async e => {
            if(!confirm(`Are you sure you want to delete cue ${cueNumber}?`)) return;
            await delete cueStorage.cueStack[cueNumber];
            renderCues();
        });

        document.getElementById(`cue-stack-go-${escapeCueName(cueNumber)}`).addEventListener("click", () => {
            goToCueNumber(cueNumber);
        });

        document.getElementById(`cue-stack-fade-time-${escapeCueName(cueNumber)}`).addEventListener("click", () => {
            openFadeMatrix(cueNumber);
        });
    }

    cueStackTable.querySelectorAll(".cue-stack-cue").forEach(cell => {
        cell.addEventListener("click", e => {
            if (!e.ctrlKey) return;

            const cueNumber = e.currentTarget.getAttribute("data-cue-number");
            const channel = e.currentTarget.getAttribute("data-channel");
            if (!cueStorage.cueStack[cueNumber]?.movers?.[channel]) return;

            delete cueStorage.cueStack[cueNumber].movers[channel];
            renderCues();
        });
    });
}

/**
 * Flashes the cell red to indicate an error and replaces the cell's content with the original number
 * @param {*} cell the cell element
 * @param {*} originalCueNumber the cue number that was originally in the cell
 */
function rejectCueNumberEdit(cell, originalCueNumber) {
    console.log("Reject?");
    cell.textContent = originalCueNumber;
    cell.classList.remove("cue-stack-number-error");
    void cell.offsetWidth;
    cell.classList.add("cue-stack-number-error");
}

/**
 * Creates a fade time matrix and opens it
 * @param {*} selectedCueNumber optional- a cue number to highlight when the dialog opens
 */
function openFadeMatrix(selectedCueNumber) {
    let dialog = document.getElementById("fade-matrix-dialog");
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "fade-matrix-dialog";
        document.body.appendChild(dialog);
    }

    const cueRows = Object.entries(cueStorage.cueStack).sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]));
    dialog.innerHTML = `
        <form method="dialog" class="fade-matrix">
            <div class="fade-matrix-header">
                <div>
                    <h3>Fade time matrix</h3>
                </div>
                <button type="submit" aria-label="Close fade editor">Close</button>
            </div>
            <div class="fade-matrix-scroller">
                <table class="fade-matrix-table">
                    <thead>
                        <tr>
                            <th>Cue</th>
                            <th>Apply all</th>
                            ${CUE_FADE_GROUPS.map(group => `<th title="${groupTitle(group.id)}">${group.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${cueRows.map(([cueNumber, cue]) => `
                            <tr data-cue-number="${cueNumber}" class="${selectedCueNumber == cueNumber ? "fade-matrix-selected-row" : ""}">
                                <th scope="row">${cueNumber}</th>
                                <td>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        data-cue-number="${cueNumber}"
                                        data-apply-all="true"
                                        value="${getCueFadeApplyAllValue(cue)}"
                                        aria-label="Apply all fades for cue ${cueNumber}"
                                    >
                                </td>
                                ${CUE_FADE_GROUPS.map(group => `
                                    <td>
                                        ${cueStackAppliesGroup(cue, group.id) ? `
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.1"
                                                data-cue-number="${cueNumber}"
                                                data-group="${group.id}"
                                                value="${getCueFadeTime(cue, group.id)}"
                                                aria-label="${groupTitle(group.id)} fade for cue ${cueNumber}"
                                            >
                                        ` : ""}
                                    </td>
                                `).join("")}
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        </form>
    `;

    dialog.querySelectorAll(".fade-matrix-table input").forEach(input => {
        input.addEventListener("change", e => {
            const cueNumber = e.target.getAttribute("data-cue-number");
            const cue = cueStorage.cueStack[cueNumber];
            const fadeTime = Math.max(0, Number.parseFloat(e.target.value));
            if (Number.isNaN(fadeTime)) {
                e.target.value = e.target.hasAttribute("data-apply-all") ? getCueFadeApplyAllValue(cue) : getCueFadeTime(cue, e.target.getAttribute("data-group"));
                return;
            }

            if (e.target.hasAttribute("data-apply-all")) {
                setAllCueFadeTimes(cueNumber, fadeTime);
                dialog.querySelectorAll("input[data-group]").forEach(groupInput => {
                    if (groupInput.getAttribute("data-cue-number") === cueNumber) groupInput.value = fadeTime;
                });
            }
            else {
                setCueFadeTime(cueNumber, e.target.getAttribute("data-group"), fadeTime);
                dialog.querySelectorAll("input[data-apply-all]").forEach(applyAllInput => {
                    if (applyAllInput.getAttribute("data-cue-number") === cueNumber) {
                        applyAllInput.value = getCueFadeApplyAllValue(cue);
                    }
                });
            }
            renderCues();
        });
    });

    if (!dialog.open) dialog.showModal();

    if (selectedCueNumber !== undefined) {
        const selectedRow = dialog.querySelector(`tr[data-cue-number="${cssSafeCueNumber(selectedCueNumber)}"]`);
        if (selectedRow) {
            selectedRow.scrollIntoView({block: "center", inline: "nearest"});
            selectedRow.classList.remove("fade-matrix-flash-row");
            requestAnimationFrame(() => selectedRow.classList.add("fade-matrix-flash-row"));
        }
    }
}

/**
 * Renders all cues
 */
async function renderCues() {
    if (!currentState) return;
    if (!cueStorage?.cues) return;

    const moverList = document.getElementById("mover-list");
    moverList.innerHTML = `<p class="cue-section-header">Movers</p>`;

    for (let mover of currentState.movers) {
        const ft = mover.fixtureType || '375z';
        const label = ft === '475z' ? `475z #${mover.channel}` : `Mover #${mover.channel}`;
        moverList.innerHTML += `
            <p class="cue-table-mover cue-table-mover-main" data-channel="${mover.channel}" data-mode="all" id="cue-table-mover-${mover.channel}">${label}</p>
        `;
    }


    const cueList = document.getElementById("cue-list");
    cueList.innerHTML = `
        <p class="cue-section-header">Saved cues</p>
        <div id="cue-table-cues"></div>
    `;

    const cueTableCues = document.getElementById("cue-table-cues");
    cueTableCues.innerHTML = `
        <p class="cue-table-header">Cue name</p>
        ${CUE_APPLY_GROUPS.map(group => `<p class="cue-table-header" title="${groupTitle(group.id)}">${group.label}</p>`).join("")}
        <p class="cue-table-header">Edit</p>
    `;

    const cueNames = Object.keys(cueStorage.cues);
    for (const [cueIndex, cueName] of cueNames.entries()) {
        const applyState = getCueApplyState(cueStorage.cues[cueName]);
        const isSpecialCue = isSpecialCueName(cueName);
        cueTableCues.innerHTML += `
            <span class="cue-table-cue-drop" data-cue-index="${cueIndex}"></span>
            <p class="cue-table-cue ${isSpecialCue ? "cue-table-special" : ""}" id="cue-table-cue-${cueName}">${cueName}</p>
            ${CUE_APPLY_GROUPS.map(group => `
                <span>
                    <input
                        type="checkbox"
                        class="cue-table-cue-apply-${escapeCueName(cueName)}"
                        data-cue-name="${cueName}"
                        data-group="${group.id}"
                        title="${groupTitle(group.id)}"
                        ${applyState[group.id] ? "checked" : ""}
                        ${isSpecialCue ? "disabled" : ""}
                    />
                </span>
            `).join("")}
            <button type="button" class="cue-edit-button" data-cue-name="${cueName}" ${isSpecialCue && cueName === SPECIAL_CUE_STAGE ? "disabled" : ""}>Edit</button>
        `;
    }
    cueTableCues.innerHTML += `<span class="cue-table-cue-drop" data-cue-index="${cueNames.length}"></span>`;

    if (!cueNames.length) cueList.innerHTML += `<p class="empty-message">No cues saved.</p>`;
    cueList.innerHTML += `<p class="cue-table-cue cue-table-add">+</p>`;
    cueList.innerHTML += `<p class="cue-table-delete"><img src="imgs/bin.svg" width="15"/></p>`;

    await generateCueStackTable();

    for (const moverListing of moverList.querySelectorAll(".cue-table-mover-main")) {
        setupDragDrop(moverListing, Number.parseInt(moverListing.getAttribute("data-channel")), document.querySelectorAll(".cue-table-cue, .cue-editor-mover"), async event => {
            if (event.target.classList.contains("cue-editor-mover")) {
                captureCueEditorFromMover(event.data);
                return;
            }

            if (event.target.className.includes("cue-table-add")) {
                const cueName = prompt("Enter new cue name:");
                if (!cueName || isSpecialCueName(cueName)) return;
                setCue(cueName, event.data);

                renderCues();
            }
            else {
                if (isSpecialCueName(event.target.innerHTML)) return;
                if (confirm(`Are you sure you want to overwrite cue ${event.target.innerHTML}?`)) {
                    await setCue(event.target.innerHTML, event.data);
                }
            }
        });
    }

    for (const cueListing of cueList.querySelectorAll(".cue-table-cue")) {
        const cueName = cueListing.innerHTML;
    
        if (cueName === "+") continue;

        setupCueApplyDrag(document.getElementsByClassName(`cue-table-cue-apply-${escapeCueName(cueName)}`));

        setupDragDrop(cueListing, cueName, document.querySelectorAll(".cue-table-mover, .cue-table-delete, .cue-stack-add, .cue-stack-cue, .cue-table-cue, .cue-table-cue-drop, .cue-editor-mover"), async event => {
            if (event.target.classList.contains("cue-editor-mover")) {
                openCueEditor(cueName);
                return;
            }

            //dragging over delete cue
            if (event.target.classList.contains("cue-table-delete")) {
                if (isSpecialCueName(cueName)) return;
                if (confirm(`Are you sure you want to delete cue ${cueName}?`)) {
                    delete cueStorage.cues[cueName];
                    renderCues();
                }
                return;
            }

            if (event.target.classList.contains("cue-table-add")) return;

            if (event.target.classList.contains("cue-table-cue-drop")) {
                moveSavedCueToIndex(cueName, Number.parseInt(event.target.getAttribute("data-cue-index")));
                return;
            }

            if (event.target.classList.contains("cue-table-cue") && !event.target.classList.contains("cue-table-add")) {
                if (isSpecialCueName(event.target.innerHTML)) return;
                moveSavedCueToIndex(cueName, Object.keys(cueStorage.cues).indexOf(event.target.innerHTML));
                return;
            }

            const ch = Number.parseInt(event.target.getAttribute("data-channel"));
            
            //dragging over cue-stack-add, create a new cue
            if(event.target.classList.contains("cue-stack-add")) {
                const cueNumber = Number.parseFloat(prompt("Enter new cue number:"));
                if(isNaN(cueNumber) || !cueNumber) return;
                cueStorage.cueStack[cueNumber] = {movers: {[ch]: cueName}, fadeTime: 0};
                renderCues();
                return;
            }

            //dragging over an existing cue, overwrite its data
            if(event.target.classList.contains("cue-stack-cue")) {
                const cueNumber = event.target.getAttribute("data-cue-number");
                cueStorage.cueStack[cueNumber].movers[ch] = cueName;
                await renderCues();
                return;
            }

            sendMoverSet(ch, getCueValues(cueName));
        });
    }

    cueList.querySelectorAll(".cue-edit-button").forEach(button => {
        button.addEventListener("click", e => {
            e.stopPropagation();
            openCueEditor(e.currentTarget.getAttribute("data-cue-name"));
        });
    });

    applyCueStackState(currentCueNumber, 0);
    refreshCueEditorFromStorage();
}

/**
 * Gets the values of a cue that are set to be applied
 * @param {*} cueName the name of the cue
 */
function getCueValues(cueName) {
    const cue = cueStorage.cues[cueName];
    if (!cue) return {};

    const applyState = getCueApplyState(cue);
    return Object.fromEntries(Object.entries(cue).filter(([key]) => {
        const group = CUE_APPLY_KEYS.get(key);
        return group && applyState[group];
    }));
}

/**
 * Gets the default apply state for a cue (currently all except mover function)
 */
function getDefaultCueApplyState() {
    return Object.fromEntries(CUE_APPLY_GROUPS.map(group => [group.id, group.defaultOn]));
}

/**
 * Returns an object that associates apply ids with true / false depending on their state
 * Returns the default if one isn't set
 * @param {*} cue the cue object
 */
function getCueApplyState(cue) {
    if (cue?.apply) return {...getDefaultCueApplyState(), ...cue.apply};

    const applyState = getDefaultCueApplyState();
    if (cue?.mode === "pos") {
        for (const group of CUE_APPLY_GROUPS) applyState[group.id] = group.id === "POS";
    }
    else if (cue?.mode === "no-pos") {
        applyState.POS = false;
    }
    return applyState;
}

/**
 * Returns the title for a apply group id
 * @param {*} groupId 
 */
function groupTitle(groupId) {
    return {
        POS: "Position",
        SPD: "Mover speed",
        DM: "Dimmer",
        FZ: "Focus and zoom",
        CO: "Colour",
        GB: "Gobo",
        ROT: "Gobo rotation",
        PS: "Prism",
        SH: "Shutter",
        FN: "Function",
    }[groupId] || groupId;
}

function escapeCueName(cueName) {
    return cueName.toString().replaceAll(" ","-").replaceAll(".","-");
}

function cssSafeCueNumber(cueNumber) {
    return String(cueNumber).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
    return escapeHtml(value);
}

function clampDmx(value) {
    const parsed = Number.parseInt(value);
    if (Number.isNaN(parsed)) return 0;
    return Math.max(0, Math.min(255, parsed));
}

/**
 * Returns true if the cue name is a special cue
 * @param {*} cueName the cue name to check
 */
function isSpecialCueName(cueName) {
    return SPECIAL_CUE_NAMES.includes(cueName);
}

/**
 * Sets up drag and drop for an element
 * @param {Element} element The element to make draggable
 * @param {*} data The data to be transferred
 * @param {Element[]} targets acceptable targets for dropping
 * @param {Function} onDrop function to be called when element is dropped. The target and data are passed to it in an object
 */
function setupDragDrop(element, data, targets, onDrop) {
    element.draggable = true;
    if (!element.id) element.id = `drag-${Math.random().toString(36).slice(2)}`;
    let elementId = element.id.toLowerCase();
    element.addEventListener("dragstart", event => {
        event.dataTransfer.setData(elementId, JSON.stringify(data));
        [...targets].forEach(t => t.classList.add("drag-active"));
    });

    element.addEventListener("dragend", event => {
        [...targets].forEach(t => {
            t.classList.remove("drag-active");
            t.classList.remove("drag-hover");
        });
    });

    for (let target of targets) {
        target.addEventListener("dragover", event => {
            if (event.dataTransfer.types.includes(elementId)) event.preventDefault();
        });

        target.addEventListener("dragenter", event => {
            if (event.dataTransfer.types.includes(elementId)) target.classList.add("drag-hover");
        });

        target.addEventListener("dragleave", () => {
            target.classList.remove("drag-hover");
        });

        target.addEventListener("drop", event => {
            if (!event.dataTransfer.types.includes(elementId)) return;

            target.classList.remove("drag-hover");
            event.preventDefault();
            event.stopImmediatePropagation();
            const data = JSON.parse(event.dataTransfer.getData(elementId));
            onDrop({ target, data });
        });
    }
}

/**
 * Sorts the cues in the cue stack by number and returns their numbers as strings in an array
 */
function getCueNumberList() {
    return Object.keys(cueStorage.cueStack).map(parseFloat).sort((a,b) => a - b).map(x => x.toString());
}

/**
 * Sends a socket message to move the cue number forward / backward by a specified amount
 * If no cue is currently set it starts and the beginning / end of the cue stack depending on the sign of d
 * @param {number} d the amount to move the cue forward by (negative for backward)
 * @returns 
 */
function moveCueNumber(d) {
    const cueNumberList = getCueNumberList();
    let cueIndex = cueNumberList.indexOf(currentCueNumber);

    if(cueIndex == -1 && d < 0) cueIndex = cueNumberList.length;

    if(cueIndex + d < 0 || cueIndex + d > cueNumberList.length - 1) {
        clearCurrentCue();
        return;
    }

    cueIndex += d;
    
    socket.send(JSON.stringify({
        type: "GOTO_CUE_NUMBER",
        cueNumber: (cueNumberList[cueIndex]).toString()
    }));
}

/**
 * Sends a socket message to jump to a cue number
 * @param {string} cueNumber the cue number to go to
 */
function goToCueNumber(cueNumber) {
    const normalizedCueNumber = cueNumber?.toString().trim();
    if (!normalizedCueNumber) return;

    socket.send(JSON.stringify({
        type: "GOTO_CUE_NUMBER",
        cueNumber: normalizedCueNumber
    }));
}

/**
 * Sends a socket message to clear the current cue
 */
function clearCurrentCue() {
    socket.send(JSON.stringify({
        type: "CLEAR_CUE"
    }));
}

function resetAllMovers() {
    socket.send(JSON.stringify({
        type: "RESET_ALL"
    }));
}

function blackoutAllMovers() {
    socket.send(JSON.stringify({
        type: "BLACKOUT_ALL"
    }));
}

function resetAllMovers() {
    socket.send(JSON.stringify({
        type: "RESET_ALL"
    }));
}

function blackoutAllMovers() {
    socket.send(JSON.stringify({
        type: "BLACKOUT_ALL"
    }));
}

/**
 * Sends a socket message to request the state to be sent to the client again
 * (Instant State Update)
 */
function requestISU() {
    socket.send(JSON.stringify({
        type: 'GET_STATE'
    }));
}

function load() {
    renderCues();
}

if (document.readyState != "loading") load();
else document.addEventListener("DOMContentLoaded", load);

Object.assign(window, {
    addMover,
    moveCueNumber,
    clearCurrentCue,
    resetAllMovers,
    blackoutAllMovers,
    requestISU
});
