import { it, expect } from "vitest";
import { enqueue, tick, replay, seed } from "./simulation";
it("deduplicates requests and refuses key conflicts", () => {
  const s = seed(),
    input = { key: "new", type: "x.created", data: { x: 1 }, responses: [200] };
  const a = enqueue(s, input);
  expect(enqueue(a, input)).toBe(a);
  expect(() => enqueue(a, { ...input, data: { x: 2 } })).toThrow("différent");
});
it("replay only requeues failed events and preserves attempt receipts", () => {
  const s = seed();
  const id = s.events[2].id;
  const r = tick(replay(s, id), 0).events.find((e) => e.id === id)!;
  expect(r.state).toBe("delivered");
  expect(r.history).toHaveLength(6);
  expect(s.events[2].history).toHaveLength(5);
  expect(replay(s, s.events[0].id).events[0]).toEqual(s.events[0]);
});
it("waits for backoff and eventually dead-letters transient failures", () => {
  let s = enqueue(
    { now: 0, events: [] },
    { key: "fail", type: "x.failed", data: {}, responses: [503] },
  );
  s = tick(s, 0);
  expect(s.events[0].history).toHaveLength(1);
  expect(tick(s, 500).events[0].history).toHaveLength(1);
  for (let i = 0; i < 4; i++) s = tick(s, 60000);
  expect(s.events[0].state).toBe("dead");
  expect(tick(s, 60000).events[0].history).toHaveLength(5);
});
it("does not retry permanent client errors", () => {
  const s = tick(
    enqueue(
      { now: 0, events: [] },
      { key: "bad", type: "x.bad", data: {}, responses: [400] },
    ),
    0,
  );
  expect(s.events[0].state).toBe("dead");
});
