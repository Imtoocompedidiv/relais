import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue } from "./store.mjs";
import {
  deliver,
  signature,
  verifySignature,
  validateTarget,
  retryAfter,
} from "./delivery.mjs";
import { createAPI } from "./http.mjs";
const input = {
  key: "invoice-1",
  type: "invoice.paid",
  data: { amount: 1200 },
};
test("idempotency preserves ID and refuses conflicting content", () => {
  const q = new Queue();
  try {
    const a = q.create(input, 0);
    assert.equal(q.create(input, 1).event.id, a.event.id);
    assert.throws(
      () => q.create({ ...input, data: { amount: 2 } }),
      /different content/,
    );
    assert.equal(q.list().length, 1);
  } finally {
    q.close();
  }
});
test("file persistence, exclusive claims, expired leases and stale acknowledgements", () => {
  const dir = mkdtempSync(join(tmpdir(), "relais-"));
  let q = new Queue(join(dir, "q.db"));
  q.create(input, 0);
  q.close();
  q = new Queue(join(dir, "q.db"));
  const other = new Queue(join(dir, "q.db"));
  try {
    const first = q.claim(0, 100);
    assert.ok(first);
    assert.equal(other.claim(1), null);
    const second = other.claim(101);
    assert.ok(second);
    assert.equal(q.finish(first, { status: 200 }, 102), false);
    assert.equal(other.finish(second, { status: 200 }, 103), true);
    assert.equal(q.get(first.id).history[0].outcome, "lease_expired");
  } finally {
    q.close();
    other.close();
    rmSync(dir, { recursive: true });
  }
});
test("retry schedule and five-attempt dead letter, manual replay preserves history", () => {
  const q = new Queue();
  try {
    const id = q.create(input, 0).event.id;
    let now = 0;
    for (let i = 1; i <= 5; i++) {
      const e = q.claim(now);
      assert.equal(e.attempts, i);
      q.finish(e, { status: 503, retryable: true }, now, () => 0);
      now += 1000 * 2 ** (i - 1);
    }
    assert.equal(q.get(id).state, "dead");
    assert.equal(q.retry(id, now), true);
    const replay = q.claim(now);
    assert.equal(replay.attempts, 6);
    q.finish(replay, { status: 200 }, now);
    assert.equal(q.get(id).history.length, 6);
    assert.equal(q.retry(id), false);
  } finally {
    q.close();
  }
});
test("429 Retry-After, redirect refusal and signed request body", async () => {
  const q = new Queue();
  try {
    q.create(input, 0);
    const e = q.claim(0);
    await deliver(q, e, {
      target: "https://example.test/hook",
      secret: "a".repeat(32),
      now: () => 0,
      fetcher: async (url, opts) => {
        assert.equal(opts.redirect, "manual");
        assert.equal(
          opts.headers["x-relais-signature"],
          signature("a".repeat(32), e.id, "0", e.body),
        );
        return new Response("", {
          status: 429,
          headers: { "retry-after": "10" },
        });
      },
    });
    assert.ok(q.get(e.id).next_at >= 10000);
    assert.equal(q.claim(9999), null);
  } finally {
    q.close();
  }
});
test("signatures reject tampering and old timestamps", () => {
  const sig = signature("secret", "id", "100", "{}");
  assert.equal(verifySignature("secret", "id", "100", "{}", sig, 100000), true);
  assert.equal(
    verifySignature("secret", "id", "100", "[]", sig, 100000),
    false,
  );
  assert.equal(
    verifySignature("secret", "id", "100", "{}", sig, 500000),
    false,
  );
});
test("targets require HTTPS or explicit loopback opt-in", () => {
  assert.throws(() => validateTarget("http://localhost:5555"));
  assert.equal(
    validateTarget("http://localhost:5555", true),
    "http://localhost:5555/",
  );
  assert.throws(() => validateTarget("https://user:secret@example.test"));
  assert.throws(() => validateTarget("http://example.test", true));
  assert.equal(retryAfter("bad", 0), 0);
});
test("API authentication, duplicate submit, validation and conflict", async () => {
  const q = new Queue();
  const token = "t".repeat(32);
  const api = createAPI(q, token);
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${api.address().port}/events`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const post = (data) =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      });
    assert.equal((await post(input)).status, 201);
    assert.equal((await post(input)).status, 200);
    assert.equal((await post({ ...input, data: { amount: 1 } })).status, 409);
    assert.equal((await post({})).status, 400);
  } finally {
    await new Promise((r) => api.close(r));
    q.close();
  }
});
