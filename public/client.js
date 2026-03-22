import cueStorage from "./cueStorage.js";
import channelValues from "./channelValueUtil.js";

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
            currentState = msg.state;
            for (const mover of msg.state.movers)
                renderMover(mover);
            renderCues();
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

socket.onerror = (err) => {
    console.error("WebSocket error: ", err, "please refresh the page.");
    document.body.innerHTML = "<h1>Connection error: " + err.message + "</h1><p>Please refresh the page.</p>";
}

socket.onclose = () => {
    document.body.innerHTML = "<h1>Connection closed</h1><p>Please refresh the page.</p>";
}

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

function renderMover(mover) {
    const ch = mover.channel;
    if (!document.getElementById(`mover-${ch}`)) {
        const template = document.getElementById('mover-template').innerHTML;
        const html = template.replace(/\{ch\}/g, ch);
        const div = document.createElement('div');
        div.innerHTML = html;
        document.querySelector('.movers').appendChild(div.firstElementChild);
        initMoverControls(ch);
    }
    fillMoverFromChannelValues(ch, mover.channelValues);
}

function setSlider(ch, id, val) {
    document.getElementById(`${ch}-${id}`).value = val;
    switch (id) {
        case 'zoom':
            let deg = 23 + (10 - 23) * (val / 255); // Narrow to wide
            document.getElementById(`${ch}-${id}-label`).textContent = deg.toFixed(1) + '°';
            break;
        case 'pt-speed':
            let pct = 100 - Math.round(val / 255 * 100);
            document.getElementById(`${ch}-${id}-label`).textContent = pct + '%';
            break;
        case 'dimmer':
            document.getElementById(`${ch}-${id}-label`).textContent = (val / 2.55).toFixed(1) + '%';
            break;
        case 'pan':
            let panDeg = 540 * (val / 255) - 270; // -270 to +270
            document.getElementById(`${ch}-${id}-label`).textContent = panDeg.toFixed(0) + '°';
            break;
        case 'tilt':
            let tiltDeg = 270 * (val / 255) - 135; // -135 to +135
            document.getElementById(`${ch}-${id}-label`).textContent = tiltDeg.toFixed(0) + '°';
            break;
        default:
            document.getElementById(`${ch}-${id}-label`).textContent = val;
    }
}

function setSelectSpeed(ch, suffix, sel, spd) {
    document.getElementById(`${ch}-${suffix}`).value = sel;
    const wrap = document.getElementById(`${ch}-${suffix}-speed-wrap`);
    if (spd !== undefined) {
        const pct = Math.round(spd * 100);
        document.getElementById(`${ch}-${suffix}-speed`).value = pct;
        document.getElementById(`${ch}-${suffix}-speed-label`).textContent = pct + '%';
        wrap.classList.remove('noSee');
    } else {
        wrap.classList.add('noSee');
    }
}

function fillMoverFromChannelValues(ch, cv) {
    if (!cv) return;

    // Simple 0-255 sliders
    const simpleSliders = [
        ['pan', ch + 0],
        ['pan-fine', ch + 1],
        ['tilt', ch + 2],
        ['tilt-fine', ch + 3],
        ['pt-speed', ch + 4],
        ['focus', ch + 9],
        ['dimmer', ch + 10],
        ['zoom', ch + 14],
    ];
    for (const [id, abs] of simpleSliders) {
        if (cv[abs] !== undefined) setSlider(ch, id, cv[abs]);
    }

    // Color wheel (ch+5)
    const col = cv[ch + 5];
    if (col !== undefined) {
        if (col < 64) setSelectSpeed(ch, 'color', `w:${Math.floor(col / 8) * 8}`);
        else if (col <= 189) setSelectSpeed(ch, 'color', 'indexed', (col - 64) / 125);
        else if (col <= 221) setSelectSpeed(ch, 'color', 'cycle', (col - 190) / 31);
        else setSelectSpeed(ch, 'color', 'rcycle', (col - 222) / 33);
    }

    // Gobo wheel (ch+6)
    const gob = cv[ch + 6];
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
        else if (gob <= 189) setSelectSpeed(ch, 'gobo', 'cycle', (gob - 128) / 61);
        else if (gob <= 193) setSelectSpeed(ch, 'gobo', 'w:0');
        else setSelectSpeed(ch, 'gobo', 'rcycle', (gob - 194) / 61);
    }

    // Gobo rotation (ch+7)
    const rot = cv[ch + 7];
    if (rot !== undefined) {
        if (rot === 0) setSelectSpeed(ch, 'gobo-rot', 'nofunc');
        else if (rot <= 63) setSelectSpeed(ch, 'gobo-rot', 'index', (rot - 1) / 62);
        else if (rot <= 145) setSelectSpeed(ch, 'gobo-rot', 'fwd', (rot - 64) / 81);
        else if (rot <= 149) setSelectSpeed(ch, 'gobo-rot', 'stop');
        else if (rot <= 231) setSelectSpeed(ch, 'gobo-rot', 'rev', (rot - 150) / 81);
        else setSelectSpeed(ch, 'gobo-rot', 'bounce', (rot - 232) / 23);
    }

    // Prism (ch+8)
    const pri = cv[ch + 8];
    if (pri !== undefined) {
        if (pri < 4) setSelectSpeed(ch, 'prism', 'nofunc');
        else if (pri <= 6) setSelectSpeed(ch, 'prism', '6faucet');
        else if (pri <= 65) setSelectSpeed(ch, 'prism', '6fwd', (pri - 7) / 58);
        else if (pri <= 127) setSelectSpeed(ch, 'prism', '6rev', (pri - 66) / 57);
        else if (pri <= 134) setSelectSpeed(ch, 'prism', pri < 132 ? 'nofunc' : '5faucet');
        else if (pri <= 193) setSelectSpeed(ch, 'prism', '5fwd', (pri - 135) / 58);
        else if (pri <= 251) setSelectSpeed(ch, 'prism', '5rev', (pri - 194) / 57);
        else setSelectSpeed(ch, 'prism', '5faucet');
    }

    // Shutter (ch+11)
    const shu = cv[ch + 11];
    if (shu !== undefined) {
        if (shu < 4) setSelectSpeed(ch, 'shutter', 'closed');
        else if (shu < 8) setSelectSpeed(ch, 'shutter', 'open');
        else if (shu <= 76) setSelectSpeed(ch, 'shutter', 'strobe', (shu - 8) / 68);
        else if (shu <= 145) setSelectSpeed(ch, 'shutter', 'pulse', (shu - 77) / 68);
        else if (shu <= 215) setSelectSpeed(ch, 'shutter', 'random', (shu - 146) / 69);
        else setSelectSpeed(ch, 'shutter', 'open');
    }

    // Function (ch+12)
    const fn = cv[ch + 12];
    if (fn !== undefined) {
        document.getElementById(`${ch}-func`).value = String(fn);
    }
}

function sendMoverSet(ch, values) {
    socket.send(JSON.stringify({ type: 'MOVER_SET', channel: ch, values }));
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
            switch(id) {
                case 'zoom':
                    let deg = 28 + (10 - 28) * (slider.value / 255); // Narrow to wide
                    label.textContent = deg.toFixed(1) + '°';
                    break;
                case 'pt-speed':
                    let pct = 100 - Math.round(slider.value / 255 * 100);
                    label.textContent = pct + '%';
                    break;
                case 'dimmer':
                    label.textContent = (slider.value / 2.55).toFixed(1) + '%';
                    break;
                case 'pan':
                    let panDeg = 540 * (slider.value / 255) - 270; // -270 to +270
                    label.textContent = panDeg.toFixed(0) + '°';
                    break;
                case 'tilt':
                    let tiltDeg = 270 * (slider.value / 255) - 135; // -135 to +135
                    label.textContent = tiltDeg.toFixed(0) + '°';
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
        sendMoverSet(ch, { GoboWheel: channelValues.computeGoboValue(ch) });
    });
    goboSpeed.addEventListener('input', () => {
        goboSpeedLbl.textContent = goboSpeed.value + '%';
        sendMoverSet(ch, { GoboWheel: channelValues.computeGoboValue(ch) });
    });

    // Gobo rotation
    const goboRotSelect = document.getElementById(`${ch}-gobo-rot`);
    const goboRotSpeedWrap = document.getElementById(`${ch}-gobo-rot-speed-wrap`);
    const goboRotSpeed = document.getElementById(`${ch}-gobo-rot-speed`);
    const goboRotSpeedLbl = document.getElementById(`${ch}-gobo-rot-speed-label`);
    const needsGoboRotSpeed = () => !['nofunc', 'stop'].includes(goboRotSelect.value);
    goboRotSelect.addEventListener('change', () => {
        goboRotSpeedWrap.classList.toggle('noSee', !needsGoboRotSpeed());
        sendMoverSet(ch, { GoboRotation: channelValues.computeGoboRotValue(ch) });
    });
    goboRotSpeed.addEventListener('input', () => {
        goboRotSpeedLbl.textContent = goboRotSpeed.value + '%';
        sendMoverSet(ch, { GoboRotation: channelValues.computeGoboRotValue(ch) });
    });

    // Prism
    const prismSelect = document.getElementById(`${ch}-prism`);
    const prismSpeedWrap = document.getElementById(`${ch}-prism-speed-wrap`);
    const prismSpeed = document.getElementById(`${ch}-prism-speed`);
    const prismSpeedLbl = document.getElementById(`${ch}-prism-speed-label`);
    const needsPrismSpeed = () => !['nofunc', '6faucet', '5faucet'].includes(prismSelect.value);
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
    });
}

async function setCue(cueName, ch) {
    const cueState = currentState.movers.filter(m => m.channel == ch)[0].channelValues;
    await cueStorage.setCue(cueName, cueState);
    await renderCues();
}

async function deleteCue(cueName){
    await cueStorage.deleteCue(cueName);
    await renderCues();
}

async function renderCues() {
    const cueStorageSaveOptions = document.querySelector(".cue-storage-save-options");
    let fileHandle = await cueStorage.getFileHandle();
    if(fileHandle) {
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
            catch(e) {
                console.error(e);
                alert("Sync error\n"+e);
            }
        });
    }
    else {
        cueStorageSaveOptions.innerHTML = `
            <button id="open-cue-file">Sync cues with a file on your device</button>
        `;
        document.getElementById("open-cue-file").addEventListener("click", async () => {
            await cueStorage.openNewFile();
            await cueStorage.syncCues();
            renderCues();
        });
    }

    if(!currentState) return;
    
    const moverList = document.getElementById("mover-list");
    moverList.innerHTML = `<p class="cue-table-header">Movers</p>`;

    for(let mover of currentState.movers)
        moverList.innerHTML += `<p class="cue-table-mover" data-channel="${mover.channel}" id="cue-table-mover-${mover.channel}">Mover # ${mover.channel}</p>`;


    const cueList = document.getElementById("cue-list");
    cueList.innerHTML = `<p class="cue-table-header">Saved cues</p>`;

    const cueNames = Object.keys(cueStorage.getCues());
    for(let cueName of cueNames)
            cueList.innerHTML += `<p class="cue-table-cue" id="cue-table-cue-${cueName}">${cueName}</p>`;

    if(!cueNames.length) cueList.innerHTML += `<p class="empty-message">No cues saved.</p>`;
    cueList.innerHTML += `<p class="cue-table-cue cue-table-add">+</p>`;
    cueList.innerHTML += `<p class="cue-table-delete"><img src="imgs/bin.svg" width="15"/></p>`;

    for(const moverListing of moverList.querySelectorAll(".cue-table-mover")) {
        setupDragDrop(moverListing, Number.parseInt(moverListing.getAttribute("data-channel")), document.getElementsByClassName("cue-table-cue"), async event => {
            if(event.target.className.includes("cue-table-add")) {
                const cueName = prompt("Enter new cue name:");
                if(!cueName) return;
                await setCue(cueName, event.data);
            }
            else {
                if(confirm(`Are you sure you want to overwrite cue ${event.target.innerHTML}?`)){
                    await setCue(event.target.innerHTML, event.data);
                }
            }
        });
    }

    for(const cueListing of cueList.querySelectorAll(".cue-table-cue")) {
        const cueName = cueListing.innerHTML;
        setupDragDrop(cueListing, cueName, document.querySelectorAll(".cue-table-mover, .cue-table-delete"), async event => {
            if(event.target.classList.contains("cue-table-delete")) {
                if(confirm(`Are you sure you want to delete cue ${cueName}?`)) await deleteCue(cueName);
                return;
            }
            const ch = Number.parseInt(event.target.getAttribute("data-channel"));
            sendMoverSet(ch, await cueStorage.getCue(cueName));
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
        [...targets].forEach(t => t.classList.remove("drag-active"));
    });

    for(let target of targets) {
        target.addEventListener("dragover", event => {
            if(event.dataTransfer.types.includes(elementId)) event.preventDefault();
        });

        target.addEventListener("drop", event => {
            if(!event.dataTransfer.types.includes(elementId)) return;
            
            event.preventDefault();
            event.stopImmediatePropagation();
            const data = JSON.parse(event.dataTransfer.getData(elementId));
            onDrop({target, data});
        });
    }
}

async function load() {
    try {
        await cueStorage.syncCues();
    }
    catch(e) {
        console.error(e);
        alert("Error when syncing cues\n"+e);
    }
    renderCues();
}

function requestISU() {
    socket.send(JSON.stringify({
        type: 'GET_STATE'
    }));
}

if(document.readyState != "loading") load();
else document.addEventListener("load", load);

//globally accessible functions
Object.assign(window, {
    addMover,
    requestISU
});