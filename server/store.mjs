import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";

export class Queue {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, hash TEXT NOT NULL, type TEXT NOT NULL,
        body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
        cycle_start INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, next_at INTEGER NOT NULL,
        lease_until INTEGER, lease_token TEXT, last_status INTEGER, last_error TEXT);
      CREATE TABLE IF NOT EXISTS attempts (
        event_id TEXT NOT NULL REFERENCES events(id), number INTEGER NOT NULL, started_at INTEGER NOT NULL,
        finished_at INTEGER, status INTEGER, outcome TEXT NOT NULL DEFAULT 'processing', error TEXT,
        PRIMARY KEY(event_id,number));`);
  }
  create({ key, type, data }, now = Date.now()) {
    if (typeof key !== "string" || !/^[\w.:-]{1,128}$/.test(key))
      throw new Error("Invalid idempotency key");
    if (typeof type !== "string" || !/^[a-z][a-z0-9_.-]{0,99}$/.test(type))
      throw new Error("Invalid event type");
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error("Data must be an object");
    const body = JSON.stringify({ type, data });
    if (Buffer.byteLength(body) > 64000)
      throw new Error("Payload exceeds 64 KB");
    const hash = createHash("sha256").update(body).digest("hex");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT OR IGNORE INTO events(id,key,hash,type,body,created_at,next_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(id, key, hash, type, body, now, now);
    const event = this.db.prepare("SELECT * FROM events WHERE key=?").get(key);
    if (event.hash !== hash) {
      const error = new Error(
        "Idempotency key already used for different content",
      );
      error.code = "CONFLICT";
      throw error;
    }
    return { event, created: event.id === id };
  }
  list(limit = 100) {
    return this.db
      .prepare(
        "SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?",
      )
      .all(Math.min(500, Math.max(1, limit)));
  }
  get(id) {
    const event = this.db.prepare("SELECT * FROM events WHERE id=?").get(id);
    return event
      ? {
          ...event,
          history: this.db
            .prepare("SELECT * FROM attempts WHERE event_id=? ORDER BY number")
            .all(id),
        }
      : null;
  }
  claim(now = Date.now(), leaseMs = 30000) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const e = this.db
        .prepare(
          `SELECT * FROM events WHERE ((state IN ('queued','retrying') AND next_at<=?) OR (state='processing' AND lease_until<=?)) ORDER BY next_at,rowid LIMIT 1`,
        )
        .get(now, now);
      if (!e) {
        this.db.exec("COMMIT");
        return null;
      }
      if (e.state === "processing")
        this.db
          .prepare(
            "UPDATE attempts SET outcome='lease_expired',finished_at=? WHERE event_id=? AND number=? AND outcome='processing'",
          )
          .run(now, e.id, e.attempts);
      const token = randomUUID(),
        n = e.attempts + 1;
      this.db
        .prepare(
          "UPDATE events SET state='processing',attempts=?,lease_until=?,lease_token=? WHERE id=?",
        )
        .run(n, now + leaseMs, token, e.id);
      this.db
        .prepare(
          "INSERT INTO attempts(event_id,number,started_at) VALUES(?,?,?)",
        )
        .run(e.id, n, now);
      this.db.exec("COMMIT");
      return {
        ...e,
        state: "processing",
        attempts: n,
        lease_token: token,
        lease_until: now + leaseMs,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  finish(
    event,
    { status = 0, error = "", retryable = false, retryAfterMs = 0 },
    now = Date.now(),
    random = Math.random,
  ) {
    const delivered = status >= 200 && status < 300;
    const retry =
      !delivered && retryable && event.attempts - event.cycle_start < 5;
    const state = delivered ? "delivered" : retry ? "retrying" : "dead";
    const delay = Math.min(
      3600000,
      Math.max(
        retryAfterMs,
        1000 * 2 ** Math.min(event.attempts - event.cycle_start - 1, 10) +
          Math.floor(random() * 250),
      ),
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const update = this.db
        .prepare(
          "UPDATE events SET state=?,next_at=?,lease_until=NULL,lease_token=NULL,last_status=?,last_error=? WHERE id=? AND state='processing' AND lease_token=?",
        )
        .run(
          state,
          now + delay,
          status,
          error.slice(0, 500),
          event.id,
          event.lease_token,
        );
      if (update.changes)
        this.db
          .prepare(
            "UPDATE attempts SET finished_at=?,status=?,outcome=?,error=? WHERE event_id=? AND number=?",
          )
          .run(
            now,
            status,
            state,
            error.slice(0, 500),
            event.id,
            event.attempts,
          );
      this.db.exec("COMMIT");
      return Boolean(update.changes);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  retry(id, now = Date.now()) {
    return Boolean(
      this.db
        .prepare(
          "UPDATE events SET state='queued',next_at=?,cycle_start=attempts,last_error=NULL WHERE id=? AND state IN ('dead','retrying')",
        )
        .run(now, id).changes,
    );
  }
  close() {
    this.db.close();
  }
}
