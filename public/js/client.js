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

                    document.querySelectorAll(".cue-stack-table tr").forEach(r => {
                        r.style.transition = `background-color ${fadeTime}ms`;
                        r.classList.remove("cue-stack-active");
                    });

                    document.querySelectorAll("#cue-stack-row-"+msg.cueNumber).forEach(r => {
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
            switch (id) {
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

async function deleteCue(cueName) {
    await cueStorage.deleteCue(cueName);
    await renderCues();
}

async function generateCueStackTable() {
    const cueStackContainer = document.getElementById("cue-stack-container");
    cueStackContainer.innerHTML = `
        <p class="cue-table-header">Cue stack</p>
        <table id="cue-stack-table" class="cue-stack-table"></table>
        <button onclick="clearOSCCue()">Clear current cue</button>
    `;
    
    if(!Object.entries(cueStorage.cueStack).length) {
        cueStackContainer.innerHTML += `<p class="empty-message">No cues saved in cue stack</p>`;
    }

    const cueStackTable = document.getElementById("cue-stack-table");

    const cueStackTableHeader = cueStackTable.insertRow();
    cueStackTableHeader.innerHTML = `<th>Cue number</th>
        ${currentState.movers.map(m => `<th>Mover #${m.channel}</th>`).join("")}
        <th>Fade time</th>`;

    console.log(currentState.movers);

    for(const [cueNumber, cue] of Object.entries(cueStorage.cueStack)) {
        const cueRow = cueStackTable.insertRow();
        cueRow.id = "cue-stack-row-"+cueNumber;
        cueRow.innerHTML = `<td>${cueNumber}</td>
        ${currentState.movers.map(m => 
            `<td><p class="cue-stack-cue" data-channel="${m.channel}" data-cue-number="${cueNumber}">${cue.movers[m.channel] || ""}</p></td>`
        ).join("")}
        <td><p contenteditable class="cue-stack-fade-time" id="cue-stack-fade-time-${cueNumber}">${cue.fadeTime}</p></td>`;
        document.getElementById(`cue-stack-fade-time-${cueNumber}`).addEventListener("blur", async e => {
            const fadeTime = Number.parseFloat(e.target.innerHTML);
            if(isNaN(fadeTime)) return;
            await cueStorage.setFadeTime(cueNumber, fadeTime);
            e.target.innerHTML = cue.fadeTime;
            
        });
    }

    const newCueRow = cueStackTable.insertRow();
    newCueRow.classList.add("cue-stack-add-row");
    newCueRow.innerHTML = "<td>Add a cue</td>" + currentState.movers.map(m => `<td><p data-channel="${m.channel}" class="cue-stack-add">+</p></td>`).join("");
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
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-main" data-channel="${mover.channel}" data-mode="all" id="cue-table-mover-${mover.channel}">Mover #${mover.channel}</p>`;
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-sub" data-channel="${mover.channel}" data-mode="pos" id="cue-table-mover-${mover.channel}-pos">↳ Pos only</p>`;
        moverList.innerHTML += `<p class="cue-table-mover cue-table-mover-sub" data-channel="${mover.channel}" data-mode="nopos" id="cue-table-mover-${mover.channel}-nopos">↳ Not pos</p>`;
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
                const cueNumber = prompt("Enter new cue number:");
                if(!cueNumber) return;
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
            let values = cueStorage.cues[cueName];
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
    document.querySelectorAll(".cue-stack-table tr").forEach(r => {
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

//globally accessible functions
Object.assign(window, {
    addMover,
    clearOSCCue,
    requestISU
});