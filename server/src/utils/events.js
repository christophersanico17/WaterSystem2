// A tiny in-process pub/sub for Server-Sent Events, used to push live sensor
// readings and alerts to the admin dashboard as they arrive from a device —
// no polling needed. Single-process only (fine for this app's scale; a
// multi-instance deployment would swap this for Redis pub/sub or similar).

const subscribers = new Set(); // Set<express.Response>

function subscribe(res) {
  subscribers.add(res);
}

function unsubscribe(res) {
  subscribers.delete(res);
}

// Sends `event: <type>` + `data: <json>` to every connected admin. Dead
// connections are pruned opportunistically (write throws once the socket is
// gone; res.on("close") in the route handles the common case, this is a
// belt-and-suspenders cleanup for anything that slips through).
function broadcast(type, payload) {
  const message = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of subscribers) {
    try {
      res.write(message);
    } catch {
      subscribers.delete(res);
    }
  }
}

function subscriberCount() {
  return subscribers.size;
}

module.exports = { subscribe, unsubscribe, broadcast, subscriberCount };
