import { createHmac, timingSafeEqual } from "node:crypto";
export function signature(secret, id, timestamp, body) {
  return createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${body}`)
    .digest("hex");
}
export function verifySignature(
  secret,
  id,
  timestamp,
  body,
  supplied,
  now = Date.now(),
) {
  if (
    !/^\d+$/.test(String(timestamp)) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f\d]{64}$/.test(supplied)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature(secret, id, timestamp, body), "hex"),
    Buffer.from(supplied, "hex"),
  );
}
export function validateTarget(value, allowLocal = false) {
  const u = new URL(value);
  if (u.username || u.password || u.hash)
    throw new Error("Target cannot contain credentials or a fragment");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.protocol !== "https:" &&
    !(allowLocal && local && u.protocol === "http:")
  )
    throw new Error("HTTPS required (HTTP loopback may be explicitly enabled)");
  return u.toString();
}
export function retryAfter(value, now) {
  if (!value) return 0;
  const parsed = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(parsed) ? Math.min(3600000, Math.max(0, parsed)) : 0;
}
export async function deliver(
  queue,
  event,
  { target, secret, fetcher = fetch, timeoutMs = 10000, now = Date.now },
) {
  const timestamp = String(Math.floor(now() / 1000));
  try {
    const response = await fetcher(target, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      body: event.body,
      headers: {
        "content-type": "application/json",
        "x-relais-id": event.id,
        "x-relais-timestamp": timestamp,
        "x-relais-signature": signature(
          secret,
          event.id,
          timestamp,
          event.body,
        ),
      },
    });
    const status = response.status;
    const wait = retryAfter(response.headers.get("retry-after"), now());
    await response.body?.cancel();
    return queue.finish(
      event,
      {
        status,
        retryable: status >= 500 || [408, 425, 429].includes(status),
        retryAfterMs: wait,
        error: status >= 200 && status < 300 ? "" : `HTTP ${status}`,
      },
      now(),
    );
  } catch (error) {
    return queue.finish(
      event,
      {
        status: 0,
        retryable: true,
        error:
          error?.name === "TimeoutError" ? "Delivery timeout" : "Network error",
      },
      now(),
    );
  }
}
