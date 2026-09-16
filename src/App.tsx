import { useState } from "react";
import {
  seed,
  tick,
  replay,
  enqueue,
  labels,
  type State,
} from "./core/simulation";
import { CreateEvent } from "./CreateEvent";
import { Inspector } from "./Inspector";
import { download } from "./download";
const repo = "https://github.com/Imtoocompedidiv/relais";
export default function App() {
  const [sim, setSim] = useState(seed),
    [selected, setSelected] = useState("evt_demo_003"),
    [filter, setFilter] = useState("all"),
    [creating, setCreating] = useState(false),
    [message, setMessage] = useState(
      "Sélectionnez une livraison pour inspecter ses tentatives.",
    );
  const event = sim.events.find((e) => e.id === selected) ?? sim.events[0];
  const counts = {
    delivered: sim.events.filter((e) => e.state === "delivered").length,
    pending: sim.events.filter((e) => ["queued", "retrying"].includes(e.state))
      .length,
    dead: sim.events.filter((e) => e.state === "dead").length,
  };
  return (
    <div className="shell">
      <a href="#deliveries" className="skip">
        Aller aux livraisons
      </a>
      <aside className="sidebar">
        <a className="brand" href="./">
          relais
        </a>
        <nav>
          <a href="#deliveries" className="active">
            Livraisons
          </a>
          <a href={`${repo}#api`}>Documentation</a>
        </nav>
        <a
          className="author"
          href="https://imtoocompedidiv.github.io/portfolio/"
        >
          JD
        </a>
      </aside>
      <main>
        <header>
          <div>
            <h1>Chaque événement, une trace.</h1>
            <p>
              Inspectez les tentatives. Rejouez les échecs. Gardez une trace.
            </p>
            <span className="demo-label">Démonstration locale</span>
          </div>
          <button className="primary" onClick={() => setCreating(true)}>
            Créer un événement
          </button>
        </header>
        <dl className="metrics">
          <div>
            <dt>événements</dt>
            <dd>{sim.events.length}</dd>
          </div>
          <div>
            <dt>livrés</dt>
            <dd className="green">{counts.delivered}</dd>
          </div>
          <div>
            <dt>en attente</dt>
            <dd>{counts.pending}</dd>
          </div>
          <div>
            <dt>échec{counts.dead > 1 ? "s" : ""}</dt>
            <dd className="red">{counts.dead}</dd>
          </div>
        </dl>
        <div className="clockbar">
          <span>
            Horloge du simulateur{" "}
            <strong>
              {new Date(sim.now).toLocaleTimeString("fr-FR", {
                timeZone: "UTC",
              })}{" "}
              UTC
            </strong>
          </span>
          <button
            onClick={() => {
              setSim((s) => tick(s));
              setMessage(
                "Temps avancé de 10 secondes. Les événements arrivés à échéance ont été traités.",
              );
            }}
          >
            Avancer de 10 s
          </button>
          <button
            onClick={() => {
              setSim(seed());
              setSelected("evt_demo_003");
              setMessage("Exemples restaurés.");
            }}
          >
            Réinitialiser
          </button>
        </div>
        <div className="workspace" id="deliveries">
          <section className="deliveries">
            <div className="list-head">
              <h2>Livraisons</h2>
              <select
                aria-label="Filtrer par statut"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">Tous les statuts</option>
                {Object.entries(labels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Événement</th>
                    <th>Statut</th>
                    <th>Tentatives</th>
                  </tr>
                </thead>
                <tbody>
                  {sim.events
                    .filter((e) => filter === "all" || e.state === filter)
                    .map((e) => (
                      <tr
                        key={e.id}
                        className={selected === e.id ? "selected" : ""}
                      >
                        <td>
                          <button
                            onClick={() => setSelected(e.id)}
                            aria-label={`Inspecter ${e.type} ${e.id}`}
                          >
                            <strong>{e.type}</strong>
                            <span>{e.id}</span>
                          </button>
                        </td>
                        <td>
                          <span className={`badge ${e.state}`}>
                            {labels[e.state as State]}
                          </span>
                        </td>
                        <td>{e.history.length}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!sim.events.some(
              (e) => filter === "all" || e.state === filter,
            ) && <p className="empty">Aucune livraison dans cet état.</p>}
          </section>
          {event && (
            <Inspector
              event={event}
              onReplay={() => {
                setSim((s) => replay(s, event.id));
                setMessage(
                  "Événement remis en file. Dans ce scénario, la prochaine réponse sera 200.",
                );
              }}
            />
          )}
        </div>
        <p className="status" role="status">
          {message}
        </p>
        <footer>
          <span>Les appels réseau sont simulés dans cette démonstration.</span>
          <button
            onClick={() =>
              download(
                "relais-journal.json",
                JSON.stringify(sim, null, 2),
                "application/json",
              )
            }
          >
            Exporter le journal
          </button>
          <a href={`${repo}#api`}>API & installation</a>
          <a href={repo}>Code source</a>
        </footer>
      </main>
      {creating && (
        <CreateEvent
          onClose={() => setCreating(false)}
          onCreate={(input) => {
            const next = enqueue(sim, input);
            setSim(next);
            setSelected(next.events.find((e) => e.key === input.key)!.id);
            setMessage(
              next === sim
                ? "Clé déjà reçue : aucun doublon créé."
                : "Événement ajouté. Avancez le temps pour déclencher la livraison.",
            );
          }}
        />
      )}
    </div>
  );
}
