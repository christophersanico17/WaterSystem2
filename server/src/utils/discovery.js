const dgram = require("dgram");

// ───────────────────────────────────────────────────────────
// LAN server discovery for the flow-meter firmware.
//
// The ESP doesn't know this machine's IP ahead of time — it changes whenever
// the PC moves to another WiFi network or the router hands out a new lease.
// Instead of hardcoding it, the firmware broadcasts "BKWS_DISCOVER" on UDP
// DISCOVERY_PORT to the whole subnet; this socket answers with
// "BKWS_SERVER <httpPort>", and the ESP takes the reply's source IP as the
// server address. See discoverServer() in esp_water_meter.ino.
// ───────────────────────────────────────────────────────────
const DISCOVER_REQUEST = "BKWS_DISCOVER";

function startDiscoveryResponder(httpPort, discoveryPort = Number(process.env.DISCOVERY_PORT ?? 4001)) {
  // DISCOVERY_PORT=0 turns this off — e.g. on a cloud host, where there's no
  // LAN for a device to broadcast on and meters use a fixed public URL instead.
  if (!discoveryPort) return null;

  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (msg, rinfo) => {
    if (msg.toString().trim() !== DISCOVER_REQUEST) return;
    socket.send(`BKWS_SERVER ${httpPort}`, rinfo.port, rinfo.address);
    console.log(`  Device discovery request from ${rinfo.address} — replied with port ${httpPort}`);
  });

  socket.on("error", (err) => {
    // Discovery is a convenience — a port clash shouldn't take the API down.
    console.error(`  Device discovery disabled (UDP ${discoveryPort}): ${err.message}`);
    socket.close();
  });

  socket.bind(discoveryPort, () => {
    console.log(`  Device discovery listening on UDP ${discoveryPort}`);
  });

  socket.unref(); // don't keep the process alive on this alone
  return socket;
}

module.exports = { startDiscoveryResponder };
