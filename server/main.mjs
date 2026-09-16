import { Queue } from "./store.mjs";
import { createAPI } from "./http.mjs";
import { deliver, validateTarget } from "./delivery.mjs";
const token = process.env.RELAIS_TOKEN;
const secret = process.env.RELAIS_SECRET;
if (!secret || secret.length < 32)
  throw new Error("Set RELAIS_SECRET to at least 32 random characters");
const target = validateTarget(
  process.env.RELAIS_TARGET,
  process.env.RELAIS_ALLOW_LOCAL === "1",
);
const queue = new Queue(process.env.RELAIS_DB ?? "relais.db");
const server = createAPI(queue, token);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const port = Number(process.env.PORT ?? 4310);
server.listen(port, process.env.RELAIS_HOST ?? "127.0.0.1", () =>
  console.log(`Relais listening on port ${port}`),
);
let running = false,
  stopping = false;
const timer = setInterval(async () => {
  if (running || stopping) return;
  running = true;
  try {
    const event = queue.claim();
    if (event) await deliver(queue, event, { target, secret });
  } catch (error) {
    console.error("Worker failure:", error.message);
  } finally {
    running = false;
  }
}, 250);
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await new Promise((resolve) => server.close(resolve));
  while (running) await new Promise((r) => setTimeout(r, 50));
  queue.close();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
