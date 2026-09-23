import dgram from "dgram";

class ArtNetListener {
    onMsg = (data) => { console.log(data)}

    constructor(port = 6454) {
        const server = dgram.createSocket("udp4");
        console.log("Created");


        server.on("message", (msg, rinfo) => {
            const id = msg.toString("utf8", 0, 8);
            if (id != "Art-Net\0") return;

            const opCode = msg.readUInt16LE(8);

            if (opCode == 0x5000) {
                const sequence = msg.readUInt8(12);
                const physical = msg.readUInt8(13);
                const universe = msg.readUInt16LE(14);
                const length = msg.readUInt16BE(16);

                const data = Buffer.from(msg.subarray(18));

                this.onMsg({ data, universe });
            }
        });

        server.bind(port);
    }
}

new ArtNetListener();