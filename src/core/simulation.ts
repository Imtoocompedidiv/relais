export type State = "queued" | "retrying" | "delivered" | "dead";
export type Attempt = { number: number; at: number; status: number };
export type Event = {
  id: string;
  key: string;
  type: string;
  data: Record<string, unknown>;
  state: State;
  history: Attempt[];
  nextAt: number;
  cycleStart: number;
  responses: number[];
};
export type Simulation = { now: number; events: Event[] };
export const labels: Record<State, string> = {
  queued: "En attente",
  retrying: "À réessayer",
  delivered: "Livré",
  dead: "Échec",
};
export function enqueue(
  sim: Simulation,
  input: {
    key: string;
    type: string;
    data: Record<string, unknown>;
    responses: number[];
  },
): Simulation {
  if (
    !/^[\w.:-]{1,128}$/.test(input.key) ||
    !/^[a-z][a-z0-9_.-]{0,99}$/.test(input.type)
  )
    throw new Error(
      "Type ou clé invalide. Utilisez des lettres, chiffres, points et tirets.",
    );
  if (
    !input.data ||
    typeof input.data !== "object" ||
    Array.isArray(input.data)
  )
    throw new Error("Le contenu doit être un objet JSON.");
  const found = sim.events.find((e) => e.key === input.key);
  if (found) {
    if (
      JSON.stringify({ type: found.type, data: found.data }) !==
      JSON.stringify({ type: input.type, data: input.data })
    )
      throw new Error("Cette clé désigne déjà un contenu différent.");
    return sim;
  }
  return {
    ...sim,
    events: [
      {
        ...input,
        id: `evt_demo_${String(sim.events.length + 1).padStart(3, "0")}`,
        state: "queued",
        history: [],
        nextAt: sim.now,
        cycleStart: 0,
      },
      ...sim.events,
    ],
  };
}
export function tick(sim: Simulation, advanceMs = 10000): Simulation {
  const now = sim.now + advanceMs;
  return {
    now,
    events: sim.events.map((e) => {
      if (!["queued", "retrying"].includes(e.state) || e.nextAt > now) return e;
      const index = e.history.length - e.cycleStart,
        status = e.responses[Math.min(index, e.responses.length - 1)] ?? 200;
      const success = status >= 200 && status < 300,
        retryable =
          status === 0 || status >= 500 || [408, 425, 429].includes(status);
      const state: State = success
        ? "delivered"
        : retryable && index < 4
          ? "retrying"
          : "dead";
      return {
        ...e,
        state,
        nextAt: now + 1000 * 2 ** index,
        history: [
          ...e.history,
          { number: e.history.length + 1, at: now, status },
        ],
      };
    }),
  };
}
export function replay(sim: Simulation, id: string): Simulation {
  return {
    ...sim,
    events: sim.events.map((e) =>
      e.id === id && ["dead", "retrying"].includes(e.state)
        ? {
            ...e,
            state: "queued",
            nextAt: sim.now,
            cycleStart: e.history.length,
            responses: [200],
          }
        : e,
    ),
  };
}
export function seed(): Simulation {
  const now = Date.UTC(2026, 8, 16, 8, 30);
  return {
    now,
    events: [
      {
        type: "invoice.paid",
        state: "delivered",
        statuses: [200],
        responses: [200],
      },
      {
        type: "contact.created",
        state: "queued",
        statuses: [],
        responses: [503, 200],
      },
      {
        type: "order.confirmed",
        state: "dead",
        statuses: [503, 503, 503, 503, 503],
        responses: [503],
      },
      {
        type: "subscription.updated",
        state: "delivered",
        statuses: [200],
        responses: [200],
      },
      {
        type: "payment.failed",
        state: "retrying",
        statuses: [429],
        responses: [429, 200],
      },
      {
        type: "customer.deleted",
        state: "delivered",
        statuses: [200],
        responses: [200],
      },
    ].map((e, i) => ({
      id: `evt_demo_${String(i + 1).padStart(3, "0")}`,
      key: `example-${i}`,
      type: e.type,
      data: { reference: `DEMO-${100 + i}`, amount: 12900, currency: "EUR" },
      state: e.state as State,
      history: e.statuses.map((status, j) => ({
        number: j + 1,
        at: now - 60000 + j * 5000,
        status,
      })),
      nextAt: now,
      cycleStart: 0,
      responses: e.responses,
    })),
  };
}
