import channelValues from "./channelValueUtil.js";
import { CUE_APPLY_GROUPS, getFixtureProfile } from "/fixtures.js";

const CUE_APPLY_KEYS = new Map(CUE_APPLY_GROUPS.flatMap(group => group.keys.map(key => [key, group.id])));
const CUE_FADE_GROUPS = CUE_APPLY_GROUPS.filter(group => ["POS", "SPD", "DM", "FZ"].includes(group.id));
const CUE_VALUE_KEYS = [...new Set(CUE_APPLY_GROUPS.flatMap(group => group.keys))];
const SPECIAL_CUE_STAGE = "SPC:STG";
const SPECIAL_CUE_RESET = "SPC:RST";
const SPECIAL_CUE_NAMES = [SPECIAL_CUE_STAGE, SPECIAL_CUE_RESET];
const DMX_UNIVERSE_SIZE = 512;

/**
 * Gets a profile object for a mover profile, defaults to the profile for the 375z
 * @param {string} type
 */
function getProfile(type) {
    return getFixtureProfile(type);
}

const moverFixtureTypes = {};

export const socket = new WebSocket(`ws://${window.location.host}`);

let currentState, currentCueNumber;
let cueApplyDragState = null;
let suppressCueApplyClick = new WeakSet();
let suppressCueStorageUpdates = false;
const expandedChases = new Set();
const CUE_EDITOR_CHANNEL = 513;
let activeCueEditor = null;

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

            const activeMoverChannels = new Set(msg.state.movers.map(mover => String(mover.channel)));
            document.querySelectorAll(".movers > .mover").forEach(moverEl => {
                const channel = moverEl.id?.startsWith("mover-") ? moverEl.id.slice("mover-".length) : null;
                if (channel && !activeMoverChannels.has(channel)) {
                    moverEl.remove();
                    delete moverFixtureTypes[channel];
                }
            });

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
    const profile = getProfile(fixtureType);
    if (isNaN(moverCh) || moverCh < 1 || moverCh + profile.channelCount - 1 > DMX_UNIVERSE_SIZE) {
        alert(`Please enter a valid start channel. ${profile.name} uses ${profile.channelCount} channels and must fit within 1-${DMX_UNIVERSE_SIZE}.`);
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
        const template = document.getElementById('mover-template')?.firstElementChild;
        if (!template) return;

        const moverElement = template.cloneNode(true);
        moverElement.innerHTML = moverElement.innerHTML
            .replace(/\{ch\}/g, ch)
            .replace(/\{type\}/g, profile.name);
        moverElement.id = `mover-${ch}`;
        moverElement.classList.remove("noSee");

        if (profile.hasStaticGobo) {
            const selectsDiv = moverElement.querySelector('.mover-selects');
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

        document.querySelector('.movers').appendChild(moverElement);
        initMoverControls(ch, fixtureType);
    }
    fillMoverFromChannelValues(ch, mover.channelValues, fixtureType);
}

function cueToEditorChannelValues(cueName) {
    return cueObjectToEditorChannelValues(cueStorage.cues[cueName] || {});
}

function getCueEditorSlot() {
    let slot = document.getElementById("cue-editor-slot");
    if (!slot) {
        const movers = document.querySelector(".movers");
        if (!movers) return null;
        slot = document.createElement("div");
        slot.id = "cue-editor-slot";
        slot.className = "cue-editor-slot";
        movers.prepend(slot);
    }
    return slot;
}

function cueObjectToEditorChannelValues(cue) {
    const profile = getProfile(activeCueEditor?.fixtureType);
    const values = {};
    for (const key of CUE_VALUE_KEYS) {
        const offset = profile.offsets[key];
        if (offset !== undefined) values[CUE_EDITOR_CHANNEL + offset] = clampDmx(cue[key] ?? 0);
    }
    return values;
}

function setCueEditorDirty(dirty) {
    if (!activeCueEditor) return;
    activeCueEditor.dirty = dirty;
    const saveButton = document.getElementById("cue-editor-save");
    if (saveButton) saveButton.disabled = !dirty || cueStorage.cues[activeCueEditor.cueName]?.special === "stage";
}

function refreshCueEditorFromStorage(force = false) {
    if (!activeCueEditor) return;
    if (!cueStorage.cues?.[activeCueEditor.cueName]) {
        getCueEditorSlot()?.replaceChildren();
        delete moverFixtureTypes[CUE_EDITOR_CHANNEL];
        activeCueEditor = null;
        return;
    }
    if (activeCueEditor.dirty && !force) return;

    activeCueEditor.draft = {...cueStorage.cues[activeCueEditor.cueName]};
    fillMoverFromChannelValues(CUE_EDITOR_CHANNEL, cueToEditorChannelValues(activeCueEditor.cueName), activeCueEditor.fixtureType);
    setCueEditorDirty(false);
}

function saveCueEditor() {
    if (!activeCueEditor || !cueStorage.cues?.[activeCueEditor.cueName]) return;
    if (cueStorage.cues[activeCueEditor.cueName]?.special === "stage") return;

    cueStorage.cues[activeCueEditor.cueName] = {
        ...cueStorage.cues[activeCueEditor.cueName],
        ...activeCueEditor.draft,
        apply: getCueApplyState(cueStorage.cues[activeCueEditor.cueName]),
    };
    setCueEditorDirty(false);
    renderCues();
}

function captureCueEditorFromMover(channel) {
    if (!activeCueEditor || !cueStorage.cues?.[activeCueEditor.cueName]) return;
    const mover = currentState.movers.find(m => m.channel == channel);
    if (!mover) return;

    activeCueEditor.draft = {
        ...activeCueEditor.draft,
        ...Object.fromEntries(CUE_VALUE_KEYS.map(key => [key, clampDmx(mover.channelValues[key] ?? 0)])),
    };
    fillMoverFromChannelValues(CUE_EDITOR_CHANNEL, cueObjectToEditorChannelValues(activeCueEditor.draft), activeCueEditor.fixtureType);
    setCueEditorDirty(true);
}

function addStaticGoboControls(container, ch) {
    const selectsDiv = container.querySelector(".mover-selects");
    if (!selectsDiv || selectsDiv.querySelector(`#${ch}-static-gobo`)) return;

    const staticGoboBlock = document.createElement("div");
    staticGoboBlock.className = "mover-input-block";
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

function openCueEditor(cueName) {
    if (!cueStorage.cues?.[cueName]) return;
    if (cueStorage.cues[cueName]?.special === "stage") return;

    const firstMover = currentState?.movers?.[0];
    const fixtureType = firstMover?.fixtureType || "375z";
    const profile = getProfile(fixtureType);
    activeCueEditor = {
        cueName,
        fixtureType,
        draft: {...cueStorage.cues[cueName]},
        dirty: false,
    };

    const template = document.getElementById("mover-template")?.firstElementChild;
    if (!template) return;

    const editor = template.cloneNode(true);
    editor.innerHTML = editor.innerHTML
        .replace(/\{ch\}/g, CUE_EDITOR_CHANNEL)
        .replace(/\{type\}/g, escapeHtml(cueName));
    editor.id = `mover-${CUE_EDITOR_CHANNEL}`;
    editor.classList.remove("noSee");
    editor.classList.add("cue-editor-mover");
    editor.querySelector("h2").textContent = cueName;
    if (profile.hasStaticGobo) addStaticGoboControls(editor, CUE_EDITOR_CHANNEL);

    const actions = editor.querySelector(".mover-selects");
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.id = "cue-editor-save";
    saveButton.textContent = "Save";
    actions.insertBefore(saveButton, editor.querySelector(`#forget-${CUE_EDITOR_CHANNEL}`));

    const slot = getCueEditorSlot();
    if (!slot) return;
    slot.replaceChildren(editor);
    moverFixtureTypes[CUE_EDITOR_CHANNEL] = fixtureType;

    initMoverControls(CUE_EDITOR_CHANNEL, fixtureType, {
        onSet(values) {
            activeCueEditor.draft = {...activeCueEditor.draft, ...values};
            setCueEditorDirty(true);
        },
        onForget() {
            getCueEditorSlot()?.replaceChildren();
            delete moverFixtureTypes[CUE_EDITOR_CHANNEL];
            activeCueEditor = null;
        },
        forgetLabel: "Close",
    });

    fillMoverFromChannelValues(CUE_EDITOR_CHANNEL, cueToEditorChannelValues(cueName), fixtureType);
    saveButton.addEventListener("click", saveCueEditor);
    setCueEditorDirty(false);
}

/**
 * Sets the value of a mover property slider
 * @param {number} ch  mover channel
 * @param {string} id id of the property (e.g. pan-fine, zoom)
 * @param {number} val value to set (0-255)
 * @returns
 */
function setSlider(ch, id, val) {
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

function sendStartChase(ch, chaseName) {
    socket.send(JSON.stringify({ type: 'START_CHASE', channel: ch, chaseName }));
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
        .cue-stack-table-${escapeCss(currentCueNumber)},
        #cue-stack-fade-time-${escapeCss(currentCueNumber)},
        #cue-stack-number-${escapeCss(currentCueNumber)},
        #cue-stack-go-${escapeCss(currentCueNumber)},
        #cue-stack-delete-${escapeCss(currentCueNumber)}`
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
    if (change.property === "chases") change.type = "replace";
    if (change.type !== "delete" && change.propChain?.[0] === "cues") change.type = "replace";
    if (change.type !== "delete" && change.propChain?.[0] === "chases") change.type = "replace";

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
    if (cueStackEntry?.special === "stage") return 0;

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
    return Object.values(cueStackEntry?.movers || {}).some(cueRef => {
        if (isChaseRef(cueRef)) {
            return (cueStorage.chases?.[cueRef.name]?.steps || []).some(step => {
                if (hasChaseStepValues(step)) {
                    return Object.keys(step.values).some(key => CUE_APPLY_KEYS.get(key) === groupId);
                }
                const cue = cueStorage.cues[step.cue];
                return cue && getCueApplyState(cue)[groupId];
            });
        }

        const cue = cueStorage.cues[cueRef];
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

function chaseStepAppliesGroup(step, groupId) {
    if (hasChaseStepValues(step)) {
        return Object.keys(step.values).some(key => CUE_APPLY_KEYS.get(key) === groupId);
    }

    const cue = cueStorage.cues?.[step?.cue];
    return !!cue && getCueApplyState(cue)[groupId];
}

function getChaseStepFadeTime(step, groupId) {
    const groupFade = Number.parseFloat(step?.fadeTimes?.[groupId]);
    if (!Number.isNaN(groupFade)) return groupFade;

    const defaultFade = Number.parseFloat(step?.fadeTime);
    return Number.isNaN(defaultFade) ? 0 : defaultFade;
}

function setChaseStepFadeTime(chaseName, stepIndex, groupId, value) {
    const fadeTime = Math.max(0, Number.parseFloat(value));
    if (Number.isNaN(fadeTime)) return false;

    const step = cueStorage.chases?.[chaseName]?.steps?.[stepIndex];
    if (!step) return false;
    if (!step.fadeTimes) step.fadeTimes = {};
    step.fadeTimes[groupId] = fadeTime;
    return true;
}

function setAllChaseStepFadeTimes(chaseName, stepIndex, value) {
    const fadeTime = Math.max(0, Number.parseFloat(value));
    if (Number.isNaN(fadeTime)) return false;

    const step = cueStorage.chases?.[chaseName]?.steps?.[stepIndex];
    if (!step) return false;
    step.fadeTime = fadeTime;
    if (!step.fadeTimes) step.fadeTimes = {};
    for (const group of CUE_FADE_GROUPS) {
        if (chaseStepAppliesGroup(step, group.id)) step.fadeTimes[group.id] = fadeTime;
    }
    return true;
}

function getChaseStepFadeSummary(step) {
    const values = CUE_FADE_GROUPS
        .filter(group => chaseStepAppliesGroup(step, group.id))
        .map(group => getChaseStepFadeTime(step, group.id));
    const uniqueValues = [...new Set(values.map(value => value.toString()))];
    if (!uniqueValues.length) return "Fade...";
    if (uniqueValues.length === 1) return `${uniqueValues[0]}s`;
    return `${Math.min(...values)}-${Math.max(...values)}s`;
}

function getChaseStepFadeApplyAllValue(step) {
    const values = CUE_FADE_GROUPS
        .filter(group => chaseStepAppliesGroup(step, group.id))
        .map(group => getChaseStepFadeTime(step, group.id));
    if (!values.length) return "";
    return values.every(value => value === values[0]) ? values[0] : "";
}

function ensureChaseStorage() {
    if (!cueStorage.chases) cueStorage.chases = {};
}

function isChaseRef(value) {
    return value && typeof value === "object" && value.type === "chase" && typeof value.name === "string";
}

function getCueStackCellClass(cueRef) {
    if (!isChaseRef(cueRef)) return "";
    return cueStorage.chases?.[cueRef.name] ? "chase-ref" : "chase-ref broken-ref";
}

function formatCueStackCell(cueRef) {
    if (!cueRef) return "";
    if (isChaseRef(cueRef)) {
        const label = cueStorage.chases?.[cueRef.name] ? `▶ ${cueRef.name}` : `⚠ ${cueRef.name}`;
        return escapeHtml(label);
    }
    if (!cueStorage.cues?.[cueRef]) return `<span class="broken-ref">⚠ ${escapeHtml(cueRef)}</span>`;
    return escapeHtml(cueRef);
}

function createChaseRef(chaseName) {
    return { type: "chase", name: chaseName };
}

function isCueUsedInChases(cueName) {
    return Object.values(cueStorage.chases || {}).some(chase =>
        (chase.steps || []).some(step => step.cue === cueName)
    );
}

function isChaseUsedInCueStack(chaseName) {
    return Object.values(cueStorage.cueStack || {}).some(cue =>
        Object.values(cue.movers || {}).some(ref => isChaseRef(ref) && ref.name === chaseName)
    );
}

function getUniqueChaseName(baseName = "New chase") {
    ensureChaseStorage();
    if (!cueStorage.chases[baseName]) return baseName;
    let suffix = 2;
    while (cueStorage.chases[`${baseName} ${suffix}`]) suffix++;
    return `${baseName} ${suffix}`;
}

function addStepToChase(chaseName, cueName, index) {
    if (isSpecialCueName(cueName) || !cueStorage.cues?.[cueName]) return;
    const chase = cueStorage.chases[chaseName];
    if (!chase) return;
    const step = { cue: cueName, fadeTime: 0.7, waitAfterFade: 0.2 };
    if (!Array.isArray(chase.steps)) chase.steps = [];
    if (index === undefined || index < 0 || index > chase.steps.length) chase.steps.push(step);
    else chase.steps.splice(index, 0, step);
}

function getMoverStateForChaseStep(channel) {
    const mover = currentState.movers.find(m => m.channel == channel);
    if (!mover) return null;

    return Object.fromEntries(CUE_VALUE_KEYS.map(key => [key, clampDmx(mover.channelValues[key] ?? 0)]));
}

function getChaseStepLabel(step) {
    if (step?.name) return step.name;
    if (step?.cue) return step.cue;
    return "";
}

function hasChaseStepValues(step) {
    return step?.values && typeof step.values === "object";
}

function promptAddStepToChase(chaseName) {
    const cueNames = Object.keys(cueStorage.cues || {}).filter(cueName => !isSpecialCueName(cueName));
    if (!cueNames.length) {
        alert("Create a normal saved cue first, then add it to the chase.");
        return;
    }

    const cueName = prompt(`Cue name for new chase step:\n${cueNames.join("\n")}`, cueNames[0]);
    if (!cueName) return;
    if (isSpecialCueName(cueName)) {
        alert("Special cues cannot be used as chase steps.");
        return;
    }
    if (!cueStorage.cues?.[cueName]) {
        alert(`Cue not found: ${cueName}`);
        return;
    }

    addStepToChase(chaseName, cueName);
    renderCues();
}

function addMoverStateToChase(chaseName, channel, stepIndex) {
    const stepName = prompt("Name this chase step:");
    if (!stepName || isSpecialCueName(stepName)) return;

    const values = getMoverStateForChaseStep(channel);
    if (!values) return;

    const step = { name: stepName, values, fadeTime: 0.7, waitAfterFade: 0.2 };
    const chase = cueStorage.chases[chaseName];
    if (!chase) return;
    if (!Array.isArray(chase.steps)) chase.steps = [];

    if (stepIndex === undefined) chase.steps.push(step);
    else chase.steps[stepIndex] = {
        ...chase.steps[stepIndex],
        name: stepName,
        values,
        cue: undefined,
    };
    renderCues();
}

function moveChaseStep(chaseName, fromIndex, toIndex) {
    const steps = cueStorage.chases?.[chaseName]?.steps;
    if (!steps || toIndex < 0 || toIndex >= steps.length) return;
    const [step] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, step);
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
            <p contenteditable id="cue-stack-number-${escapeCss(cueNumber)}">${escapeHtml(cueNumber)}</p>
            ${currentState.movers.map(m =>
                `<p class="cue-stack-cue cue-stack-table-${escapeCss(cueNumber)} ${getCueStackCellClass(cue.movers?.[m.channel])}" data-channel="${m.channel}" data-cue-number="${escapeAttr(cueNumber)}" title="Ctrl+click to clear">${formatCueStackCell(cue.movers?.[m.channel])}</p>`
            ).join("")}
            <p class="cue-stack-fade-time" id="cue-stack-fade-time-${escapeCss(cueNumber)}" title="Open fade matrix">${getCueFadeSummary(cue)}</p>
            <p class="cue-stack-go" id="cue-stack-go-${escapeCss(cueNumber)}" title="Go to cue ${escapeAttr(cueNumber)}">Go</p>
            <p id="cue-stack-delete-${escapeCss(cueNumber)}"><img src="imgs/bin.svg" width="15"/></p>
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
        const cueNumberCell = document.getElementById(`cue-stack-number-${escapeCss(cueNumber)}`);
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

        document.getElementById(`cue-stack-delete-${escapeCss(cueNumber)}`).addEventListener("click", async e => {
            if(!confirm(`Are you sure you want to delete cue ${cueNumber}?`)) return;
            await delete cueStorage.cueStack[cueNumber];
            renderCues();
        });

        document.getElementById(`cue-stack-go-${escapeCss(cueNumber)}`).addEventListener("click", () => {
            goToCueNumber(cueNumber);
        });

        document.getElementById(`cue-stack-fade-time-${escapeCss(cueNumber)}`).addEventListener("click", () => {
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
                            ${CUE_FADE_GROUPS.map(group => `<th title="${group.title}">${group.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${cueRows.map(([cueNumber, cue]) => `
                            <tr data-cue-number="${escapeAttr(cueNumber)}" data-cue-key="${escapeCss(cueNumber)}" class="${selectedCueNumber == cueNumber ? "fade-matrix-selected-row" : ""}">
                                <th scope="row">${escapeHtml(cueNumber)}</th>
                                <td>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        data-cue-number="${escapeAttr(cueNumber)}"
                                        data-apply-all="true"
                                        value="${getCueFadeApplyAllValue(cue)}"
                                        aria-label="Apply all fades for cue ${escapeAttr(cueNumber)}"
                                    >
                                </td>
                                ${CUE_FADE_GROUPS.map(group => `
                                    <td>
                                        ${cueStackAppliesGroup(cue, group.id) ? `
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.1"
                                                data-cue-number="${escapeAttr(cueNumber)}"
                                                data-group="${group.id}"
                                                value="${getCueFadeTime(cue, group.id)}"
                                                aria-label="${group.title} fade for cue ${escapeAttr(cueNumber)}"
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
        const selectedRow = dialog.querySelector(`tr[data-cue-key="${escapeCss(selectedCueNumber)}"]`);
        if (selectedRow) {
            selectedRow.scrollIntoView({block: "center", inline: "nearest"});
            selectedRow.classList.remove("fade-matrix-flash-row");
            requestAnimationFrame(() => selectedRow.classList.add("fade-matrix-flash-row"));
        }
    }
}

function openChaseFadeMatrix(chaseName, selectedStepIndex) {
    const chase = cueStorage.chases?.[chaseName];
    if (!chase) return;

    let dialog = document.getElementById("chase-fade-matrix-dialog");
    if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "chase-fade-matrix-dialog";
        document.body.appendChild(dialog);
    }

    dialog.innerHTML = `
        <form method="dialog" class="fade-matrix">
            <div class="fade-matrix-header">
                <div>
                    <h3>${escapeHtml(chaseName)} fade matrix</h3>
                </div>
                <button type="submit" aria-label="Close chase fade editor">Close</button>
            </div>
            <div class="fade-matrix-scroller">
                <table class="fade-matrix-table">
                    <thead>
                        <tr>
                            <th>Step</th>
                            <th>Cue</th>
                            <th>Apply all</th>
                            ${CUE_FADE_GROUPS.map(group => `<th title="${group.title}">${group.label}</th>`).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${(chase.steps || []).map((step, index) => `
                            <tr data-step-index="${index}" class="${selectedStepIndex == index ? "fade-matrix-selected-row" : ""}">
                                <th scope="row">${index + 1}</th>
                                <td>${escapeHtml(getChaseStepLabel(step))}</td>
                                <td>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.1"
                                        data-step-index="${index}"
                                        data-apply-all="true"
                                        value="${getChaseStepFadeApplyAllValue(step)}"
                                        aria-label="Apply all fades for ${chaseName} step ${index + 1}"
                                    >
                                </td>
                                ${CUE_FADE_GROUPS.map(group => `
                                    <td>
                                        ${chaseStepAppliesGroup(step, group.id) ? `
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.1"
                                                data-step-index="${index}"
                                                data-group="${group.id}"
                                                value="${getChaseStepFadeTime(step, group.id)}"
                                                aria-label="${group.title} fade for ${chaseName} step ${index + 1}"
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
            const stepIndex = Number.parseInt(e.target.getAttribute("data-step-index"));
            const step = cueStorage.chases[chaseName]?.steps?.[stepIndex];
            const fadeTime = Math.max(0, Number.parseFloat(e.target.value));
            if (Number.isNaN(fadeTime)) {
                e.target.value = e.target.hasAttribute("data-apply-all") ? getChaseStepFadeApplyAllValue(step) : getChaseStepFadeTime(step, e.target.getAttribute("data-group"));
                return;
            }

            if (e.target.hasAttribute("data-apply-all")) {
                setAllChaseStepFadeTimes(chaseName, stepIndex, fadeTime);
                dialog.querySelectorAll("input[data-group]").forEach(groupInput => {
                    if (Number.parseInt(groupInput.getAttribute("data-step-index")) === stepIndex) groupInput.value = fadeTime;
                });
            }
            else {
                setChaseStepFadeTime(chaseName, stepIndex, e.target.getAttribute("data-group"), fadeTime);
                dialog.querySelectorAll("input[data-apply-all]").forEach(applyAllInput => {
                    if (Number.parseInt(applyAllInput.getAttribute("data-step-index")) === stepIndex) {
                        applyAllInput.value = getChaseStepFadeApplyAllValue(cueStorage.chases[chaseName].steps[stepIndex]);
                    }
                });
            }

            renderCues();
            openChaseFadeMatrix(chaseName, stepIndex);
        });
    });

    if (!dialog.open) dialog.showModal();

    if (selectedStepIndex !== undefined) {
        const selectedRow = dialog.querySelector(`tr[data-step-index="${Number.parseInt(selectedStepIndex)}"]`);
        selectedRow?.scrollIntoView({block: "center", inline: "nearest"});
        if (selectedRow) {
            selectedRow.classList.remove("fade-matrix-flash-row");
            requestAnimationFrame(() => selectedRow.classList.add("fade-matrix-flash-row"));
        }
    }
}

function renderChases(cueList) {
    ensureChaseStorage();
    const chaseNames = Object.keys(cueStorage.chases);
    cueList.innerHTML += `
        <div class="chase-list" id="chase-list">
            <p class="cue-section-header">Chases</p>
            <div id="chase-table"></div>
            <button type="button" id="chase-add" class="chase-add-button">+ New chase</button>
        </div>
    `;

    const chaseTable = document.getElementById("chase-table");
    if (!chaseNames.length) chaseTable.innerHTML = `<p class="empty-message">No chases saved.</p>`;

    for (const chaseName of chaseNames) {
        const chase = cueStorage.chases[chaseName];
        const expanded = expandedChases.has(chaseName);
        chaseTable.innerHTML += `
            <div class="chase-row" id="chase-row-${escapeCss(chaseName)}" data-chase-name="${escapeAttr(chaseName)}">
                <span class="chase-row-name">${expanded ? "▼" : "▶"} ${escapeHtml(chaseName)}</span>
                <button type="button" class="chase-edit" data-chase-name="${escapeAttr(chaseName)}">${expanded ? "Close" : "Edit"}</button>
                <button type="button" class="chase-fade-matrix-open" data-chase-name="${escapeAttr(chaseName)}">Fade matrix</button>
                <button type="button" class="chase-duplicate" data-chase-name="${escapeAttr(chaseName)}">Duplicate</button>
                <button type="button" class="chase-delete" data-chase-name="${escapeAttr(chaseName)}">Delete</button>
            </div>
            ${expanded ? `
                <div class="chase-expanded" data-chase-name="${escapeAttr(chaseName)}">
                    <div class="chase-step-table">
                        <p class="cue-table-header">Step</p>
                        <p class="cue-table-header">Cue</p>
                        <p class="cue-table-header">Fade</p>
                        <p class="cue-table-header">Wait</p>
                        <p class="cue-table-header">Move</p>
                        <p class="cue-table-header">Delete</p>
                        ${(chase.steps || []).map((step, index) => {
                            const stepLabel = getChaseStepLabel(step);
                            const hasValues = hasChaseStepValues(step);
                            const savedCueExists = step?.cue && cueStorage.cues?.[step.cue];
                            const isMissing = step?.cue && !savedCueExists && !hasValues;
                            return `
                            <p>${index + 1}</p>
                            <p class="chase-step-cue ${isMissing ? "broken-ref" : ""}" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}">
                                ${isMissing ? `⚠ Missing cue: ${escapeHtml(step.cue || "")}` : escapeHtml(stepLabel)}
                            </p>
                            <p>
                                <button type="button" class="chase-step-fade-summary" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}">
                                    ${getChaseStepFadeSummary(step)}
                                </button>
                            </p>
                            <p><input type="number" min="0" step="0.1" class="chase-step-time" data-field="waitAfterFade" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}" value="${Number.parseFloat(step.waitAfterFade) || 0}"></p>
                            <p>
                                <button type="button" class="chase-step-up" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button>
                                <button type="button" class="chase-step-down" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}" ${index === (chase.steps || []).length - 1 ? "disabled" : ""}>↓</button>
                            </p>
                            <p><button type="button" class="chase-step-delete" data-chase-name="${escapeAttr(chaseName)}" data-step-index="${index}">🗑</button></p>
                        `}).join("")}
                    </div>
                    ${(chase.steps || []).length ? "" : `<p class="chase-empty-message">No steps yet — drag movers or saved cues here</p>`}
                    <button type="button" class="chase-step-add" data-chase-name="${escapeAttr(chaseName)}">+ Add step / Drag movers or saved cues here</button>
                </div>
            ` : ""}
        `;
    }

    document.getElementById("chase-add")?.addEventListener("click", () => {
        const requested = prompt("Enter new chase name:", getUniqueChaseName());
        if (!requested) return;
        const chaseName = getUniqueChaseName(requested);
        cueStorage.chases[chaseName] = { loop: true, restartOnEnter: true, steps: [] };
        expandedChases.add(chaseName);
        renderCues();
    });

    chaseTable.querySelectorAll(".chase-row-name, .chase-edit").forEach(el => {
        el.addEventListener("click", e => {
            const chaseName = e.currentTarget.closest(".chase-row").getAttribute("data-chase-name");
            if (expandedChases.has(chaseName)) expandedChases.delete(chaseName);
            else expandedChases.add(chaseName);
            renderCues();
        });
    });

    chaseTable.querySelectorAll(".chase-fade-matrix-open").forEach(button => {
        button.addEventListener("click", e => {
            openChaseFadeMatrix(e.currentTarget.getAttribute("data-chase-name"));
        });
    });

    chaseTable.querySelectorAll(".chase-duplicate").forEach(button => {
        button.addEventListener("click", e => {
            const chaseName = e.currentTarget.getAttribute("data-chase-name");
            const newName = getUniqueChaseName(`${chaseName} copy`);
            cueStorage.chases[newName] = JSON.parse(JSON.stringify(cueStorage.chases[chaseName]));
            expandedChases.add(newName);
            renderCues();
        });
    });

    chaseTable.querySelectorAll(".chase-delete").forEach(button => {
        button.addEventListener("click", e => {
            const chaseName = e.currentTarget.getAttribute("data-chase-name");
            const warning = isChaseUsedInCueStack(chaseName) ? `\n\nThis chase is used in the cue stack.` : "";
            if (!confirm(`Are you sure you want to delete chase ${chaseName}?${warning}`)) return;
            delete cueStorage.chases[chaseName];
            expandedChases.delete(chaseName);
            renderCues();
        });
    });

    chaseTable.querySelectorAll(".chase-step-time").forEach(input => {
        input.addEventListener("change", e => {
            const chaseName = e.currentTarget.getAttribute("data-chase-name");
            const stepIndex = Number.parseInt(e.currentTarget.getAttribute("data-step-index"));
            const field = e.currentTarget.getAttribute("data-field");
            const value = Math.max(0, Number.parseFloat(e.currentTarget.value));
            if (Number.isNaN(value)) {
                e.currentTarget.value = cueStorage.chases[chaseName].steps[stepIndex][field] || 0;
                return;
            }
            cueStorage.chases[chaseName].steps[stepIndex][field] = value;
            renderCues();
        });
    });

    chaseTable.querySelectorAll(".chase-step-fade-summary").forEach(button => {
        button.addEventListener("click", e => {
            openChaseFadeMatrix(
                e.currentTarget.getAttribute("data-chase-name"),
                Number.parseInt(e.currentTarget.getAttribute("data-step-index"))
            );
        });
    });

    chaseTable.querySelectorAll(".chase-step-delete").forEach(button => {
        button.addEventListener("click", e => {
            const chaseName = e.currentTarget.getAttribute("data-chase-name");
            const stepIndex = Number.parseInt(e.currentTarget.getAttribute("data-step-index"));
            cueStorage.chases[chaseName].steps.splice(stepIndex, 1);
            renderCues();
        });
    });

    chaseTable.querySelectorAll(".chase-step-add").forEach(button => {
        button.addEventListener("click", e => {
            promptAddStepToChase(e.currentTarget.getAttribute("data-chase-name"));
        });
    });

    chaseTable.querySelectorAll(".chase-step-up, .chase-step-down").forEach(button => {
        button.addEventListener("click", e => {
            const chaseName = e.currentTarget.getAttribute("data-chase-name");
            const stepIndex = Number.parseInt(e.currentTarget.getAttribute("data-step-index"));
            moveChaseStep(chaseName, stepIndex, e.currentTarget.classList.contains("chase-step-up") ? stepIndex - 1 : stepIndex + 1);
            renderCues();
        });
    });
}

/**
 * Renders all cues
 */
async function renderCues() {
    if (!currentState) return;
    if (!cueStorage?.cues) return;
    ensureChaseStorage();

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
        ${CUE_APPLY_GROUPS.map(group => `<p class="cue-table-header" title="${group.title}">${group.label}</p>`).join("")}
        <p class="cue-table-header">Edit</p>
    `;

    const cueNames = Object.keys(cueStorage.cues);
    for (const [cueIndex, cueName] of cueNames.entries()) {
        const applyState = getCueApplyState(cueStorage.cues[cueName]);
        const isSpecialCue = isSpecialCueName(cueName);
        cueTableCues.innerHTML += `
            <span class="cue-table-cue-drop" data-cue-index="${cueIndex}"></span>
            <p class="cue-table-cue ${isSpecialCue ? "cue-table-special" : ""}" id="cue-table-cue-${escapeCss(cueName)}">${escapeHtml(cueName)}</p>
            ${CUE_APPLY_GROUPS.map(group => `
                <span>
                    <input
                        type="checkbox"
                        class="cue-table-cue-apply-${escapeCss(cueName)}"
                        data-cue-name="${escapeAttr(cueName)}"
                        data-group="${group.id}"
                        title="${group.title}"
                        ${applyState[group.id] ? "checked" : ""}
                        ${isSpecialCue ? "disabled" : ""}
                    />
                </span>
            `).join("")}
            <button type="button" class="cue-edit-button" data-cue-name="${escapeAttr(cueName)}" ${isSpecialCue && cueName === SPECIAL_CUE_STAGE ? "disabled" : ""}>Edit</button>
        `;
    }
    cueTableCues.innerHTML += `<span class="cue-table-cue-drop" data-cue-index="${cueNames.length}"></span>`;

    if (!cueNames.length) cueList.innerHTML += `<p class="empty-message">No cues saved.</p>`;
    cueList.innerHTML += `<p class="cue-table-cue cue-table-add">+</p>`;
    cueList.innerHTML += `<p class="cue-table-delete"><img src="imgs/bin.svg" width="15"/></p>`;
    renderChases(cueList);

    await generateCueStackTable();

    for (const moverListing of moverList.querySelectorAll(".cue-table-mover-main")) {
        setupDragDrop(moverListing, Number.parseInt(moverListing.getAttribute("data-channel")), document.querySelectorAll(".cue-table-cue, .cue-editor-mover, .chase-expanded, .chase-step-add, .chase-step-cue"), async event => {
            if (event.target.classList.contains("cue-editor-mover")) {
                captureCueEditorFromMover(event.data);
                return;
            }

            if (event.target.classList.contains("chase-expanded") || event.target.classList.contains("chase-step-add")) {
                await addMoverStateToChase(event.target.getAttribute("data-chase-name"), event.data);
                return;
            }

            if (event.target.classList.contains("chase-step-cue")) {
                await addMoverStateToChase(
                    event.target.getAttribute("data-chase-name"),
                    event.data,
                    Number.parseInt(event.target.getAttribute("data-step-index"))
                );
                return;
            }

            if (event.target.className.includes("cue-table-add")) {
                const cueName = prompt("Enter new cue name:");
                if (!cueName || isSpecialCueName(cueName)) return;
                setCue(cueName, event.data);

                renderCues();
            }
            else {
                const targetCueName = event.target.textContent;
                if (isSpecialCueName(targetCueName)) return;
                if (confirm(`Are you sure you want to overwrite cue ${targetCueName}?`)) {
                    await setCue(targetCueName, event.data);
                }
            }
        });
    }

    for (const cueListing of cueList.querySelectorAll(".cue-table-cue")) {
        const cueName = cueListing.textContent;

        if (cueName === "+") continue;

        setupCueApplyDrag(document.getElementsByClassName(`cue-table-cue-apply-${escapeCss(cueName)}`));

        setupDragDrop(cueListing, cueName, document.querySelectorAll(".cue-table-mover, .cue-table-delete, .cue-stack-add, .cue-stack-cue, .cue-table-cue:not(.cue-table-add), .cue-table-cue-drop, .cue-editor-mover, .chase-expanded, .chase-step-add, .chase-step-cue"), async event => {
            if (event.target.classList.contains("cue-editor-mover")) {
                openCueEditor(cueName);
                return;
            }

            //dragging over delete cue
            if (event.target.classList.contains("cue-table-delete")) {
                if (isSpecialCueName(cueName)) return;
                const warning = isCueUsedInChases(cueName) ? `\n\nThis cue is used in one or more chases.` : "";
                if (confirm(`Are you sure you want to delete cue ${cueName}?${warning}`)) {
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
                const targetCueName = event.target.textContent;
                if (isSpecialCueName(targetCueName)) return;
                moveSavedCueToIndex(cueName, Object.keys(cueStorage.cues).indexOf(targetCueName));
                return;
            }

            if (event.target.classList.contains("chase-expanded") || event.target.classList.contains("chase-step-add")) {
                if (isSpecialCueName(cueName)) {
                    alert("Special cues cannot be used as chase steps.");
                    return;
                }
                addStepToChase(event.target.getAttribute("data-chase-name"), cueName);
                renderCues();
                return;
            }

            if (event.target.classList.contains("chase-step-cue")) {
                if (isSpecialCueName(cueName)) {
                    alert("Special cues cannot be used as chase steps.");
                    return;
                }
                const chaseName = event.target.getAttribute("data-chase-name");
                const stepIndex = Number.parseInt(event.target.getAttribute("data-step-index"));
                cueStorage.chases[chaseName].steps[stepIndex] = {
                    ...cueStorage.chases[chaseName].steps[stepIndex],
                    cue: cueName,
                    name: undefined,
                    values: undefined,
                };
                renderCues();
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

    for (const chaseRow of cueList.querySelectorAll(".chase-row")) {
        const chaseName = chaseRow.getAttribute("data-chase-name");
        setupDragDrop(chaseRow, createChaseRef(chaseName), document.querySelectorAll(".cue-table-mover, .cue-stack-add, .cue-stack-cue"), async event => {
            const ch = Number.parseInt(event.target.getAttribute("data-channel"));

            if (event.target.classList.contains("cue-table-mover")) {
                sendStartChase(ch, chaseName);
                return;
            }

            if(event.target.classList.contains("cue-stack-add")) {
                const cueNumber = Number.parseFloat(prompt("Enter new cue number:"));
                if(isNaN(cueNumber) || !cueNumber) return;
                cueStorage.cueStack[cueNumber] = {movers: {[ch]: createChaseRef(chaseName)}, fadeTime: 0};
                renderCues();
                return;
            }

            if(event.target.classList.contains("cue-stack-cue")) {
                const cueNumber = event.target.getAttribute("data-cue-number");
                cueStorage.cueStack[cueNumber].movers[ch] = createChaseRef(chaseName);
                await renderCues();
            }
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
 * Escapes cue names and cue numbers for use in CSS selectors, ids, and classes
 * @param {*} value the value to escape
 */
function escapeCss(value) {
    return String(value)
        .replaceAll("\\", "\\\\")
        .replaceAll('"', '\\"')
        .replaceAll(" ", "-")
        .replaceAll(".", "-");
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
