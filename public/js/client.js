import cueStorage from "./cueStorage.js";
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

function getProfile(type) {
    return FIXTURE_PROFILES[type] || FIXTURE_PROFILES['375z'];
}

const moverFixtureTypes = {};

const socket = new WebSocket(`ws://${window.location.host}`);

let currentState;

let timeout = setTimeout(() => {
    document.body.innerHTML = "<h1>Connection timeout</h1><p>The server did not respond in time. Please refresh the page.</p>";
}, 5000);

socket.onopen = () => {
    clearTimeout(timeout);
    console.log("WebSocket connection established");
}

socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    switch (msg.type) {
        case 'STATE': {
            if (currentState?.movers?.length != msg.state.movers.length) renderCues();
            currentState = msg.state;
            for (const mover of msg.state.movers)
                renderMover(mover);
            break;
        }
        case 'ERROR': {
            alert(msg.message);
            break;
        }
        case "OSC": {
            if(cueStorage.cueStack[msg.cueNumber]) {
                for(let [ch, cueName] of Object.entries(cueStorage.cueStack[msg.cueNumber].movers)) {
                    ch = Number.parseInt(ch);

                    const cueToSet = cueStorage.cues[cueName];

                    const fadeTime = cueStorage.cueStack[msg.cueNumber].fadeTime * 1000;

                    document.querySelectorAll(".cue-stack-table p").forEach(r => {
                        r.style.transition = `background-color ${fadeTime}ms`;
                        r.classList.remove("cue-stack-active");
                    });

                    document.querySelectorAll(`.cue-stack-table-${msg.cueNumber}, #cue-stack-fade-time-${msg.cueNumber}, #cue-stack-number-${msg.cueNumber}, #cue-stack-delete-${msg.cueNumber}`).forEach(r => {
                        r.style.transition = `background-color ${fadeTime}ms`;
                        r.classList.add("cue-stack-active");
                    });

                    const transitionableAttributes = ["Focus", "Dimmer", "Zoom"];

                    const nonTransitionableData = {...cueToSet};
                    transitionableAttributes.forEach(a => delete nonTransitionableData[a]);
                    sendMoverSet(ch, nonTransitionableData)

                    for(const attribute of transitionableAttributes) {
                        const initialValue = currentState.movers.filter(m => m.channel == ch)[0].channelValues[attribute];
                        const targetValue = cueToSet[attribute];

                        let value  = initialValue;
                        const startTime = performance.now();
                        const intervalId = setInterval(() => {
                            const elapsedTime = performance.now() - startTime;
                            value = Math.floor(initialValue + (targetValue - initialValue) * (elapsedTime / fadeTime));
                            //console.log(initialValue, targetValue, elapsedTime, fadeTime, value);
                            if(elapsedTime >= fadeTime) {
                                value = targetValue;
                                clearInterval(intervalId);
                            }
                            console.log(attribute, value);
                            sendMoverSet(ch, {[attribute]: value});
                        }, 16.7);
                    }
                }
            }
            break;
        }
            
        default: {
            console.log("Received unknown message: ", msg);
        }
    }
};

socket.onerror = (err) => {
    console.error("WebSocket error: ", err, "please refresh the page.");
    document.body.innerHTML = "<h1>Connection error: " + err.message + "</h1><p>Please refresh the page.</p>";
}

socket.onclose = () => {
    document.body.innerHTML = "<h1>Connection closed</h1><p>Please refresh the page.</p>";
}

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

function setSlider(ch, id, val) {
    const el = document.getElementById(`${ch}-${id}`);
    if (!el) return;
    el.value = val;
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

function setSelectSpeed(ch, suffix, sel, spd) {
    const el = document.getElementById(`${ch}-${suffix}`);
    if (!el) return;
    el.value = sel;
    const wrap = document.getElementById(`${ch}-${suffix}-speed-wrap`);
    if (spd !== undefined) {
        const pct = Math.round(spd * 100);
        const spdEl = document.getElementById(`${ch}-${suffix}-speed`);
        if (spdEl) spdEl.value = pct;
        const lbl = document.getElementById(`${ch}-${suffix}-speed-label`);
        if (lbl) lbl.textContent = pct + '%';
        if (wrap) wrap.classList.remove('noSee');
    } else {
        if (wrap) wrap.classList.add('noSee');
    }
}

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
        else if (pri <= 6) setSelectSpeed(ch, 'prism', 'round');
        else if (pri <= 65) setSelectSpeed(ch, 'prism', 'rfwd', (pri - 7) / 58);
        else if (pri <= 123) setSelectSpeed(ch, 'prism', 'rrev', (pri - 66) / 57);
        else if (pri <= 127) setSelectSpeed(ch, 'prism', 'round');
        else if (pri <= 131) setSelectSpeed(ch, 'prism', 'nofunc');
        else if (pri <= 134) setSelectSpeed(ch, 'prism', 'linear');
        else if (pri <= 193) setSelectSpeed(ch, 'prism', 'lfwd', (pri - 135) / 58);
        else if (pri <= 251) setSelectSpeed(ch, 'prism', 'lrev', (pri - 194) / 57);
        else setSelectSpeed(ch, 'prism', 'linear');
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

function initMoverControls(ch, fixtureType) {
    const profile = getProfile(fixtureType);

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
        slider.addEventListener('input', () => {
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
        sendMoverSet(ch, { ColorWheel: channelValues.computeColorValue(ch) });
    });
    colorSpeed.addEventListener('input', () => {
        colorSpeedLbl.textContent = colorSpeed.value + '%';
        sendMoverSet(ch, { ColorWheel: channelValues.computeColorValue(ch) });
    });

    // Gobo wheel
    const goboSelect = document.getElementById(`${ch}-gobo`);
    const goboSpeedWrap = document.getElementById(`${ch}-gobo-speed-wrap`);
    const goboSpeed = document.getElementById(`${ch}-gobo-speed`);
    const goboSpeedLbl = document.getElementById(`${ch}-gobo-speed-label`);
    const needsGoboSpeed = () => !goboSelect.value.startsWith('w:');
    goboSelect.addEventListener('change', () => {
        goboSpeedWrap.classList.toggle('noSee', !needsGoboSpeed());
        sendMoverSet(ch, { GoboWheel: channelValues.computeGoboValue(ch, fixtureType) });
    });
    goboSpeed.addEventListener('input', () => {
        goboSpeedLbl.textContent = goboSpeed.value + '%';
        sendMoverSet(ch, { GoboWheel: channelValues.computeGoboValue(ch, fixtureType) });
    });

    // Gobo rotation
    const goboRotSelect = document.getElementById(`${ch}-gobo-rot`);
    const goboRotSpeedWrap = document.getElementById(`${ch}-gobo-rot-speed-wrap`);
    const goboRotSpeed = document.getElementById(`${ch}-gobo-rot-speed`);
    const goboRotSpeedLbl = document.getElementById(`${ch}-gobo-rot-speed-label`);
    const needsGoboRotSpeed = () => !['nofunc', 'stop'].includes(goboRotSelect.value);
    goboRotSelect.addEventListener('change', () => {
        goboRotSpeedWrap.classList.toggle('noSee', !needsGoboRotSpeed());
        sendMoverSet(ch, { GoboRotation: channelValues.computeGoboRotValue(ch, fixtureType) });
    });
    goboRotSpeed.addEventListener('input', () => {
        goboRotSpeedLbl.textContent = goboRotSpeed.value + '%';
        sendMoverSet(ch, { GoboRotation: channelValues.computeGoboRotValue(ch, fixtureType) });
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
                sendMoverSet(ch, { StaticGoboWheel: channelValues.computeStaticGoboValue(ch) });
            });
            sgSpeed.addEventListener('input', () => {
                sgSpeedLbl.textContent = sgSpeed.value + '%';
                sendMoverSet(ch, { StaticGoboWheel: channelValues.computeStaticGoboValue(ch) });
            });
        }
    }

    // Prism
    const prismSelect = document.getElementById(`${ch}-prism`);
    const prismSpeedWrap = document.getElementById(`${ch}-prism-speed-wrap`);
    const prismSpeed = document.getElementById(`${ch}-prism-speed`);
    const prismSpeedLbl = document.getElementById(`${ch}-prism-speed-label`);
    const staticPrismVals = ['nofunc', 'round', 'linear'];
    const needsPrismSpeed = () => !staticPrismVals.includes(prismSelect.value);
    prismSelect.addEventListener('change', () => {
        prismSpeedWrap.classList.toggle('noSee', !needsPrismSpeed());
        sendMoverSet(ch, { Prism: channelValues.computePrismValue(ch) });
    });
    prismSpeed.addEventListener('input', () => {
        prismSpeedLbl.textContent = prismSpeed.value + '%';
        sendMoverSet(ch, { Prism: channelValues.computePrismValue(ch) });
    });

    // Shutter
    const shutterSelect = document.getElementById(`${ch}-shutter`);
    const shutterSpeedWrap = document.getElementById(`${ch}-shutter-speed-wrap`);
    const shutterSpeed = document.getElementById(`${ch}-shutter-speed`);
    const shutterSpeedLbl = document.getElementById(`${ch}-shutter-speed-label`);
    const needsShutterSpeed = () => !['closed', 'open'].includes(shutterSelect.value);
    shutterSelect.addEventListener('change', () => {
        shutterSpeedWrap.classList.toggle('noSee', !needsShutterSpeed());
        sendMoverSet(ch, { Shutter: channelValues.computeShutterValue(ch) });
    });
    shutterSpeed.addEventListener('input', () => {
        shutterSpeedLbl.textContent = shutterSpeed.value + '%';
        sendMoverSet(ch, { Shutter: channelValues.computeShutterValue(ch) });
    });

    // Function
    const funcSelect = document.getElementById(`${ch}-func`);
    funcSelect.addEventListener('change', () => {
        sendMoverSet(ch, { Function: parseInt(funcSelect.value) });
    });

    // Forget mover
    const forgetButton = document.getElementById(`forget-${ch}`);
    forgetButton.addEventListener("click", () => {
        socket.send(JSON.stringify({
            type: 'FORGET_MOVER',
            channel: ch
        }));
        document.getElementById(`mover-${ch}`).remove();
        delete moverFixtureTypes[ch];
    });
}

async function setCue(cueName, ch) {
    const cueState = currentState.movers.filter(m => m.channel == ch)[0].channelValues;
    await cueStorage.setCue(cueName, cueState);
    await renderCues();
}

async function deleteCue(cueName) {
    await cueStorage.deleteCue(cueName);
    await renderCues();
}

async function generateCueStackTable() {
    const cueStackContainer = document.getElementById("cue-stack-container");
    cueStackContainer.innerHTML = `
        <p class="cue-table-header">Cue stack</p>
        <div id="cue-stack-table" class="cue-stack-table"></div>
    `;
    
    if(!Object.entries(cueStorage.cueStack).length) {
        cueStackContainer.innerHTML += `<p class="empty-message">No cues saved in cue stack</p>`;
    }

    const cueStackTable = document.getElementById("cue-stack-table");

    cueStackTable.style.gridTemplateColumns  = `repeat(${currentState.movers.length + 3}, 1fr)`;

    cueStackTable.innerHTML += `<p class="cue-stack-table-header">Cue number</p>
        ${currentState.movers.map(m => `<p class="cue-stack-table-header">Mover #${m.channel}</p>`).join("")}
        <p class="cue-stack-table-header">Fade time</p>
        <p class="cue-stack-table-header">Delete</p>
    `;

    for(const [cueNumber, cue] of Object.entries(cueStorage.cueStack).sort((a, b) => Number.parseFloat(a[0]) - Number.parseFloat(b[0]))) {
        cueStackTable.innerHTML += `
            <p contenteditable id="cue-stack-number-${cueNumber}">${cueNumber}</p>
            ${currentState.movers.map(m => 
                `<p class="cue-stack-cue cue-stack-table-${cueNumber}" data-channel="${m.channel}" data-cue-number="${cueNumber}">${cue.movers[m.channel] || ""}</p>`
            ).join("")}
            <p contenteditable class="cue-stack-fade-time" id="cue-stack-fade-time-${cueNumber}">${cue.fadeTime}</p>
            <p id="cue-stack-delete-${cueNumber}"><img src="imgs/bin.svg" width="15"/></p>
        `;
    }

    cueStackTable.innerHTML += `<p class="cue-stack-add-header">Add a cue</p>` + currentState.movers.map(m => `<p class="cue-stack-add" data-channel="${m.channel}">+</p>`).join("");

    //apply listeners now that table construction is done
    for(const [cueNumber, cue] of Object.entries(cueStorage.cueStack)) {
        document.getElementById(`cue-stack-number-${cueNumber}`).addEventListener("blur", async e => {
            const newCueNumber = Number.parseFloat(e.target.innerHTML);
            if(isNaN(newCueNumber) || !newCueNumber) {
                e.target.innerHTML = cueNumber;
                return;
            }
            await cueStorage.changeCueNumber(cueNumber, newCueNumber);
            renderCues();
        });
        
        document.getElementById(`cue-stack-fade-time-${cueNumber}`).addEventListener("blur", async e => {
            const fadeTime = Number.parseFloat(e.target.innerHTML);
            if(isNaN(fadeTime)) return;
            await cueStorage.setFadeTime(cueNumber, fadeTime);
            e.target.innerHTML = cue.fadeTime;
        });

        document.getElementById(`cue-stack-delete-${cueNumber}`).addEventListener("click", async e => {
            if(!confirm(`Are you sure you want to delete cue ${cueNumber}?`)) return;
            await cueStorage.deleteFromCueStack(cueNumber);
            renderCues();
        });
    }
}

async function renderCues() {
    const cueStorageSaveOptions = document.querySelector(".cue-storage-save-options");
    let fileHandle = await cueStorage.getFileHandle();
    if (fileHandle) {
        cueStorageSaveOptions.innerHTML = `
            <p>Currently syncing with ${fileHandle.name}</p>
            <button id="sync-cues">Sync now</button>
        `;
        document.getElementById("sync-cues").addEventListener("click", async () => {
            try {
                await cueStorage.syncCues();
                await renderCues();
                alert(`Sync successful`);
            }
            catch (e) {
                console.error(e);
                alert("Sync error\n" + e);
            }
        });
    }
    else {
        cueStorageSaveOptions.innerHTML = `
            <button id="open-cue-file">Sync cues with a file on your device</button>
            <button id="copy-cues-json">Copy cues JSON to clipboard</button>
        `;
        document.getElementById("open-cue-file").addEventListener("click", async () => {
            await cueStorage.openNewFile();
            await cueStorage.syncCues();
            renderCues();
        });
        document.getElementById("copy-cues-json").addEventListener("click", async () => {
            await navigator.clipboard.writeText(JSON.stringify({ cues: cueStorage.cues }));
            alert("Cues JSON copied to clipboard");
        });
    }

    if (!currentState) return;

    const moverList = document.getElementById("mover-list");
    moverList.innerHTML = `<p class="cue-table-header">Movers</p>`;

    for (let mover of currentState.movers) {
        const ft = mover.fixtureType || '375z';
        const label = ft === '475z' ? `475z #${mover.channel}` : `Mover #${mover.channel}`;
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-main" data-channel="${mover.channel}" data-mode="all" id="cue-table-mover-${mover.channel}">${label}</p>`;
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-sub" data-channel="${mover.channel}" data-mode="pos" id="cue-table-mover-${mover.channel}-pos">\u21B3 Pos only</p>`;
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-sub" data-channel="${mover.channel}" data-mode="nopos" id="cue-table-mover-${mover.channel}-nopos">\u21B3 Not pos</p>`;
    }


    const cueList = document.getElementById("cue-list");
    cueList.innerHTML = `<p class="cue-table-header">Saved cues</p>`;

    const cueNames = Object.keys(cueStorage.cues);
    for (let cueName of cueNames)
        cueList.innerHTML += `<p class="cue-table-cue" id="cue-table-cue-${cueName}">${cueName}</p>`;

    if (!cueNames.length) cueList.innerHTML += `<p class="empty-message">No cues saved.</p>`;
    cueList.innerHTML += `<p class="cue-table-cue cue-table-add">+</p>`;
    cueList.innerHTML += `<p class="cue-table-delete"><img src="imgs/bin.svg" width="15"/></p>`;

    await generateCueStackTable();

    for (const moverListing of moverList.querySelectorAll(".cue-table-mover-main")) {
        setupDragDrop(moverListing, Number.parseInt(moverListing.getAttribute("data-channel")), document.getElementsByClassName("cue-table-cue"), async event => {
            if (event.target.className.includes("cue-table-add")) {
                const cueName = prompt("Enter new cue name:");
                if (!cueName) return;
                await setCue(cueName, event.data);
            }
            else {
                if (confirm(`Are you sure you want to overwrite cue ${event.target.innerHTML}?`)) {
                    await setCue(event.target.innerHTML, event.data);
                }
            }
        });
    }

    for (const cueListing of cueList.querySelectorAll(".cue-table-cue")) {
        const cueName = cueListing.innerHTML;
        setupDragDrop(cueListing, cueName, document.querySelectorAll(".cue-table-mover, .cue-table-delete, .cue-stack-add, .cue-stack-cue"), async event => {
            if (event.target.classList.contains("cue-table-delete")) {
                if (confirm(`Are you sure you want to delete cue ${cueName}?`)) await deleteCue(cueName);
                return;
            }

            const ch = Number.parseInt(event.target.getAttribute("data-channel"));
            
            console.log(event.target);

            if(event.target.classList.contains("cue-stack-add")) {
                const cueNumber = Number.parseFloat(prompt("Enter new cue number:"));
                if(isNaN(cueNumber) || !cueNumber) return;
                cueStorage.addToCueStack(cueNumber, {movers: {[ch]: cueName}, fadeTime: 0});
                renderCues();
                return;
            }

            if(event.target.classList.contains("cue-stack-cue")) {
                const cueNumber = event.target.getAttribute("data-cue-number");
                cueStorage.updateCueStack(cueNumber, ch, event.data);
                renderCues();
                return;
            }

            const mode = event.target.getAttribute("data-mode") ?? "all";
            const POS_KEYS = new Set(['Pan', 'PanFine', 'Tilt', 'TiltFine']);
            let values = cueStorage.getCue(cueName);
            if (mode === "pos") {
                values = Object.fromEntries(Object.entries(values).filter(([k]) => POS_KEYS.has(k)));
            } else if (mode === "nopos") {
                values = Object.fromEntries(Object.entries(values).filter(([k]) => !POS_KEYS.has(k)));
            }
            sendMoverSet(ch, values);
        });
    }
}

function setupDragDrop(element, data, targets, onDrop) {
    element.draggable = true;
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

async function load() {
    try {
        await cueStorage.syncCues();
    }
    catch (e) {
        console.error(e);
        alert("Error when syncing cues\n" + e);
    }
    renderCues();
}

function clearOSCCue() {
    document.querySelectorAll(".cue-stack-table p").forEach(r => {
        r.style.transition = `background-color 500ms`;
        r.classList.remove("cue-stack-active");
    });
}

function requestISU() {
    socket.send(JSON.stringify({
        type: 'GET_STATE'
    }));
}

if (document.readyState != "loading") load();
else document.addEventListener("load", load);

Object.assign(window, {
    addMover,
    clearOSCCue,
    requestISU
});
