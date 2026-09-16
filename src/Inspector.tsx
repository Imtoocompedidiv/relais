import type { Event } from "./core/simulation";
export function Inspector({
  event,
  onReplay,
}: {
  event: Event;
  onReplay: () => void;
}) {
  return (
    <section className="inspector" aria-label="Détail de la livraison">
      <div className="inspector-top">
        <div>
          <h2>{event.type}</h2>
          <p className="identifier">{event.id}</p>
        </div>
        <button
          className="primary"
          onClick={onReplay}
          disabled={!["dead", "retrying"].includes(event.state)}
        >
          Rejouer
        </button>
      </div>
      <h3>Tentatives de livraison</h3>
      <ol className="timeline">
        {event.history.map((a) => (
          <li
            key={a.number}
            className={a.status >= 200 && a.status < 300 ? "ok" : "fail"}
          >
            <div>
              <strong>
                {a.number}.{" "}
                {new Date(a.at).toLocaleTimeString("fr-FR", {
                  timeZone: "UTC",
                })}{" "}
                UTC
              </strong>
              <span className={`http ${a.status < 300 ? "good" : "bad"}`}>
                {a.status || "Réseau"}
              </span>
            </div>
            <p>POST /webhooks</p>
            <span>
              {a.status >= 200 && a.status < 300
                ? "Livré avec succès"
                : a.status === 429
                  ? "Limite de débit atteinte"
                  : a.status >= 500
                    ? "Service indisponible"
                    : "Échec de livraison"}
            </span>
          </li>
        ))}
      </ol>
      {!event.history.length && (
        <p className="empty">
          L’événement attend sa première tentative. Avancez le temps pour le
          traiter.
        </p>
      )}
      <div className="payload-head">
        <h3>Corps de la requête</h3>
        <span>JSON</span>
      </div>
      <pre>
        {JSON.stringify({ type: event.type, data: event.data }, null, 2)}
      </pre>
      <p className="key">
        Clé d’idempotence <code>{event.key}</code>
      </p>
    </section>
  );
}
