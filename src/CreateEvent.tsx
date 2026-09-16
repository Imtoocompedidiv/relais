import { useEffect, useRef, useState } from "react";
export function CreateEvent({
  onCreate,
  onClose,
}: {
  onCreate: (input: {
    key: string;
    type: string;
    data: Record<string, unknown>;
    responses: number[];
  }) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [type, setType] = useState("invoice.paid"),
    [key, setKey] = useState("facture-2026-42"),
    [body, setBody] = useState(
      '{\n  "reference": "FAC-42",\n  "amount": 89000,\n  "currency": "EUR"\n}',
    ),
    [scenario, setScenario] = useState("retry"),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="create-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onCreate({
              key,
              type,
              data: JSON.parse(body),
              responses:
                scenario === "retry"
                  ? [503, 503, 200]
                  : scenario === "fail"
                    ? [400]
                    : [200],
            });
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : "JSON invalide.");
          }
        }}
      >
        <div className="dialog-head">
          <h2 id="create-title">Créer un événement</h2>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
        <p>
          Ajoutez un événement au simulateur. Aucun appel externe n’est
          effectué.
        </p>
        <label>
          Type
          <input
            value={type}
            required
            onChange={(e) => setType(e.target.value)}
          />
        </label>
        <label>
          Clé d’idempotence
          <input
            value={key}
            required
            onChange={(e) => setKey(e.target.value)}
          />
        </label>
        <label>
          Contenu JSON
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
          />
        </label>
        <label>
          Réponses simulées
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            <option value="retry">503, 503, puis 200</option>
            <option value="success">200 immédiatement</option>
            <option value="fail">400 : échec définitif</option>
          </select>
        </label>
        <p role="alert" className="error">
          {error}
        </p>
        <button className="primary" type="submit">
          Ajouter à la file
        </button>
      </form>
    </dialog>
  );
}
