import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Queue } from "./store.mjs";
import { createAPI } from "./http.mjs";
import { deliver, verifySignature } from "./delivery.mjs";
test("real HTTP delivery from API through queue to signed receiver", async () => {
  const secret = "s".repeat(32),
    token = "t".repeat(32),
    queue = new Queue();
  let received;
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString();
    received = {
      body,
      valid: verifySignature(
        secret,
        req.headers["x-relais-id"],
        req.headers["x-relais-timestamp"],
        body,
        req.headers["x-relais-signature"],
      ),
    };
    res.writeHead(204);
    res.end();
  });
  const api = createAPI(queue, token);
  await Promise.all([
    new Promise((r) => receiver.listen(0, "127.0.0.1", r)),
    new Promise((r) => api.listen(0, "127.0.0.1", r)),
  ]);
  try {
    const response = await fetch(
      `http://127.0.0.1:${api.address().port}/events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          key: "integration-1",
          type: "invoice.paid",
          data: { amount: 42 },
        }),
      },
    );
    assert.equal(response.status, 201);
    const { event } = await response.json();
    await deliver(queue, queue.claim(), {
      target: `http://127.0.0.1:${receiver.address().port}/hook`,
      secret,
    });
    assert.equal(received.valid, true);
    assert.equal(JSON.parse(received.body).data.amount, 42);
    assert.equal(queue.get(event.id).state, "delivered");
    assert.equal(queue.get(event.id).history[0].status, 204);
  } finally {
    await Promise.all([
      new Promise((r) => api.close(r)),
      new Promise((r) => receiver.close(r)),
    ]);
    queue.close();
  }
});
