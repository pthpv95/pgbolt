import { useState } from "react";
import type { SavedConnection } from "../types";
import { api } from "../api";

interface Props {
  initial?: SavedConnection | null;
  onSave: (conn: SavedConnection) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ConnectionModal({ initial, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "Local");
  const [host, setHost] = useState(initial?.host ?? "localhost");
  const [port, setPort] = useState(initial?.port ?? 5432);
  const [user, setUser] = useState(initial?.user ?? "postgres");
  const [password, setPassword] = useState(initial?.password ?? "");
  const [database, setDatabase] = useState(initial?.database ?? "postgres");
  const [ssl, setSsl] = useState(initial?.ssl ?? false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function testAndSave() {
    setTesting(true);
    setError(null);
    // Reuse the existing id when editing, so this replaces the same backend
    // connection pool instead of leaking the old one under a new id.
    const id = initial?.id ?? crypto.randomUUID();
    const config = { host, port, user, password, database, ssl };
    try {
      await api.connect(id, config);
      onSave({ id, name, ...config });
    } catch (e) {
      setError(String(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{initial ? "Edit connection" : "New connection"}</h2>

        <div className="field">
          <label>Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field row2">
          <div>
            <label>Host</label>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div>
            <label>Port</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>User</label>
          <input type="text" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div className="field">
          <label>Database</label>
          <input
            type="text"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
          />
        </div>

        <div className="field check">
          <input
            id="ssl"
            type="checkbox"
            checked={ssl}
            onChange={(e) => setSsl(e.target.checked)}
          />
          <label htmlFor="ssl" style={{ margin: 0 }}>
            Require SSL
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          {onDelete && (
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Delete connection "${name}"?`)) onDelete();
              }}
            >
              Delete
            </button>
          )}
          <div className="modal-actions-spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={testAndSave} disabled={testing}>
            {testing ? "Connecting…" : initial ? "Save changes" : "Test & save"}
          </button>
        </div>
      </div>
    </div>
  );
}
