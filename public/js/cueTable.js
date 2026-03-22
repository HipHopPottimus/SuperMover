import {currentState, sendMoverSet} from "./client.js";
import cueStorage from "./cueStorage.js";

async function setCue(cueName, ch) {
    const cueState = currentState.movers.filter(m => m.channel == ch)[0].channelValues;
    await cueStorage.setCue(cueName, cueState);
    await renderCues();
}

async function deleteCue(cueName){
    await cueStorage.deleteCue(cueName);
    await renderCues();
}

async function generateCueSaveOptions() {
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
}

async function generateCueStackTable() {
    const cueStackContainer = document.getElementById("cue-stack-container");
    cueStackContainer.innerHTML = `
        <p class="cue-table-header">Cue stack</p>
        <table id="cue-stack-table" class="cue-stack-table"></table>
    `;
    
    if(!cueStorage.cueStack.length) {
        cueStackContainer.innerHTML += `<p class="empty-message">No cues saved in cue stack</p>`;
    }


    const cueStackTable = document.getElementById("cue-stack-table");

    const cueStackTableHeader = cueStackTable.insertRow();
    cueStackTableHeader.innerHTML = "<th>Cue number</th>" + currentState.movers.map(m => `<th>Mover #${m.channel}</th>`).join("");

    for(const cue of cueStorage.cueStack) {
    }

    const newCueRow = cueStackTable.insertRow();
    newCueRow.classList.add("cue-stack-add-row");
    newCueRow.innerHTML = "<td>Add a cue</td>" + currentState.movers.map(m => `<td><p class="cue-stack-add">+</p></td>`).join("");
}

async function renderCues() {
    await generateCueSaveOptions();

    if(!currentState) return;
    
    const moverList = document.getElementById("mover-list");
    moverList.innerHTML = `<p class="cue-table-header">Movers</p>`;

    for(let mover of currentState.movers)
        moverList.innerHTML += `<p class="cue-table-mover" data-channel="${mover.channel}" id="cue-table-mover-${mover.channel}">Mover #${mover.channel}</p>`;


    const cueList = document.getElementById("cue-list");
    cueList.innerHTML = `<p class="cue-table-header">Saved cues</p>`;

    const cueNames = Object.keys(cueStorage.cues);
    for(let cueName of cueNames)
            cueList.innerHTML += `<p class="cue-table-cue" id="cue-table-cue-${cueName}">${cueName}</p>`;

    if(!cueNames.length) cueList.innerHTML += `<p class="empty-message">No cues saved.</p>`;
    cueList.innerHTML += `<p class="cue-table-add">+</p>`;
    cueList.innerHTML += `<p class="cue-table-delete"><img src="imgs/bin.svg" width="15"/></p>`;

    await generateCueStackTable();

    for(const moverListing of moverList.querySelectorAll(".cue-table-mover")) {
        setupDragDrop(moverListing, Number.parseInt(moverListing.getAttribute("data-channel")), document.querySelectorAll(".cue-table-cue, .cue-table-add"), async event => {
            if(event.target.className.includes("cue-table-add")) {
                const cueName = prompt("Enter new cue name:");
                if(!cueName) return;
                await setCue(cueName, event.data);
            }
            else if(event.target.className.includes("cue-stack-add")) {
                cellIndex
                renderCues();
                return;
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
        setupDragDrop(cueListing, cueName, document.querySelectorAll(".cue-table-mover, .cue-table-delete, .cue-stack-add"), async event => {
            if(event.target.classList.contains("cue-table-delete")) {
                if(confirm(`Are you sure you want to delete cue ${cueName}?`)) await deleteCue(cueName);
                return;
            }
            const ch = Number.parseInt(event.target.getAttribute("data-channel"));
            sendMoverSet(ch, await cueStorage.cues[cueName]);
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

if(document.readyState != "loading") load();
else document.addEventListener("load", load);

export default {
    renderCues
}