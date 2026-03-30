import IDBWebStorage from "../libs/IDBWebStorage.js";

const storage = new IDBWebStorage("SuperMoverStorage");

await storage.loadData();

if(!storage.data.cues) storage.data.cues = {};
if(!storage.data.changes) storage.data.changes = [];
if(!storage.data.cueStack) storage.data.cueStack = {};

await storage.saveData();

/** @returns {Promise<FileSystemHandle> | false} */
async function getFileHandle(){
    let fileHandle = storage.data.cueFileHandle;
    let permission;
    try{
        permission = await fileHandle.queryPermission({mode:"readwrite"}) == "granted";
        //check to make sure the file still exists
        await fileHandle.getFile();
    }
    catch(e) {
        //the file doesn't exist
        if(e.name == "NotFoundError" || e.name == "TypeError") return false;
        permission = false;
    }
    if(!permission){
        await new Promise((resolve,reject) => {
            let popup = document.createElement("dialog");
            popup.innerHTML = `
            <p>We need permission to edit your cues file</p>
            <button class="request-permission-popup-button">Give permission</button>
            `;
            document.body.appendChild(popup);
            popup.show();
            popup.querySelector(".request-permission-popup-button").addEventListener("click", async () => {
                let permission = await fileHandle.requestPermission({mode: "readwrite"});
                if(permission == "granted"){
                    popup.remove();
                    //resolve all other popups that might have been created
                    document.querySelectorAll(".request-permission-popup-button").forEach(b => b.click());
                    resolve();
                }
                else {
                    alert("There was an error getting permission. Check your browser permissions");
                }
            });
        });
    }
    return fileHandle;
}

async function readFileHandle(){
    let handle = await getFileHandle();
    let file = await handle.getFile();
    return JSON.parse(await file.text());
}

async function writeFileHandle(newContent){
    let handle = await getFileHandle();
    let writeable = await handle.createWritable();
    writeable.write(JSON.stringify(newContent));
    await writeable.close();
}

async function openNewFile(){
    let [fileHandle] = await window.showOpenFilePicker(
    {
        types: [{
            description: "SuperMover cues JSON files",
            accept: {"application/json":[".json"]}
        }],
        excludeAcceptAllOption: true,
        multiple: false
    }
    );
    storage.data.cueFileHandle = fileHandle;
    await storage.saveData();
}

async function logChange(cueName, changeType) {
    storage.data.changes.push({cueName, changeType}); 
    await storage.saveData();
}

async function setCue(cueName, data) {
    storage.data.cues[cueName] = data;
    await logChange(cueName, "update");
}

async function deleteCue(cueName) {
    delete storage.data.cues[cueName];
    await logChange(cueName, "delete");
}

async function addToCueStack(cueNumber, cue) {
    storage.data.cueStack[cueNumber] = cue;
    await logChange(cueNumber, "cue-stack-update");
}

async function setFadeTime(cueNumber, fadeTime) {
    storage.data.cueStack[cueNumber].fadeTime = fadeTime;
    await logChange(cueNumber, "cue-stack-update");
}

async function updateCueStack(cueNumber, ch, newCue) {
    storage.data.cueStack[cueNumber].movers[ch] = newCue;
    await logChange(cueNumber, "cue-stack-update");
}

async function syncCues() {
    if(!await getFileHandle()) return;
    await storage.saveData();

    const ourVersion = storage.data;

    let theirVersion;
    try {
        theirVersion = await readFileHandle();
    }
    catch {
        theirVersion = {};
    }

    if(!theirVersion.cues) theirVersion.cues = {};
    if(!theirVersion.cueStack) theirVersion.cueStack = {};

    for(const change of storage.data.changes) {
        switch(change.changeType) {
            case "update":
                theirVersion.cues[change.cueName] = ourVersion.cues[change.cueName];
                break;
            case "delete":
                delete theirVersion.cues[change.cueName];
                break;
        }
    }

    storage.data.changes = [];

    storage.data.cues = theirVersion.cues;

    await storage.saveData();
    
    await writeFileHandle(theirVersion);
}

export default {
    getFileHandle,
    openNewFile,
    setCue,
    deleteCue,
    addToCueStack,
    updateCueStack,
    setFadeTime,
    get cues() {
        return storage.data.cues;
    },
    get cueStack() {
        return storage.data.cueStack;
    },
    syncCues
}