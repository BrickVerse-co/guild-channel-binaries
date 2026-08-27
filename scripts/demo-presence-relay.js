const dgram = require("node:dgram");

const payload = Buffer.from(JSON.stringify({
	source: "brickverse-client",
	applicationId: "871308379992260629",
	applicationName: "BrickVerse Presence Preview",
	details: "Testing rich presence relay",
	state: "Installer development",
	assets: {
		largeImage: "multiplayer",
		largeText: "BrickVerse",
		smallImage: "app",
		smallText: "Local preview",
	},
	party: { id: "presence-preview", size: [1, 8] },
	timestamps: { start: new Date().toISOString() },
}));

const socket = dgram.createSocket("udp4");
socket.send(payload, 45837, "127.0.0.1", (error) => {
	if (error) throw error;
	console.log("Sent a sample presence to the running Guild Chat app.");
	socket.close();
});
