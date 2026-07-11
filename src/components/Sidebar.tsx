import { useEffect, useState } from "react";
import type { SavedConnection, TableInfo, TableRef } from "../types";
import { api } from "../api";

interface Props {
  connections: SavedConnection[];
  activeId: string | null;
  connError: string | null;
  onSelect: (conn: SavedConnection) => void;
  onAdd: () => void;
  onEdit: (conn: SavedConnection) => void;
  onToggleFavorite: (id: string) => void;
  onPickTable: (schema: string, table: string) => void;
}

export function Sidebar({
  connections,
  activeId,
  connError,
  onSelect,
  onAdd,
  onEdit,
  onToggleFavorite,
  onPickTable,
}: Props) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, TableInfo[] | undefined>>({});
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TableRef[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setSchemas([]);
    setOpen({});
    setSearch("");
    setSearchResults([]);
    if (!activeId) return;
    const id = activeId;
    api
      .listSchemas(id)
      .then(async (schemaList) => {
        if (id !== activeId) return;
        setSchemas(schemaList);
        // Expand every schema by default so tables are visible without a click.
        const entries = await Promise.all(
          schemaList.map(async (s) => [s, await api.listTables(id, s).catch(() => [])] as const)
        );
        if (id === activeId) setOpen(Object.fromEntries(entries));
      })
      .catch(() => setSchemas([]));
  }, [activeId]);

  useEffect(() => {
    if (!activeId || !search.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const id = activeId;
    const query = search.trim();
    const timer = setTimeout(() => {
      api
        .searchTables(id, query)
        .then((results) => {
          if (id === activeId) setSearchResults(results);
        })
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [search, activeId]);

  async function toggle(schema: string) {
    if (open[schema]) {
      setOpen((o) => ({ ...o, [schema]: undefined }));
      return;
    }
    if (!activeId) return;
    const tables = await api.listTables(activeId, schema);
    setOpen((o) => ({ ...o, [schema]: tables }));
  }

  // Favorites bubble to the top; otherwise preserve saved order.
  const sortedConnections = [...connections].sort(
    (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0)
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <span>Connections</span>
        <button className="icon-btn" title="New connection" onClick={onAdd}>
          +
        </button>
      </div>

      <div className="sidebar-scroll">
        {sortedConnections.map((c) => (
          <div
            key={c.id}
            className={`conn-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c)}
          >
            <span className="conn-dot" />
            <span className="conn-name">{c.name}</span>
            <button
              className={`icon-btn conn-star ${c.favorite ? "active" : ""}`}
              title={c.favorite ? "Unfavorite" : "Favorite"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(c.id);
              }}
            >
              {c.favorite ? "★" : "☆"}
            </button>
            <button
              className="icon-btn conn-edit"
              title="Edit connection"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(c);
              }}
            >
              ✎
            </button>
          </div>
        ))}

        {connError && <div className="form-error sidebar-error">{connError}</div>}

        {activeId && (
          <div className="search-box">
            <input
              type="text"
              placeholder="Search tables…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        {activeId && search.trim() ? (
          <>
            <div className="sidebar-section" style={{ marginTop: 8 }}>
              <span>{searching ? "Searching…" : `Results (${searchResults.length})`}</span>
            </div>
            {searchResults.map((t) => (
              <div
                key={`${t.schema}.${t.name}`}
                className="tree-table search-result"
                title={`${t.schema}.${t.name} · ${t.kind}`}
                onClick={() => onPickTable(t.schema, t.name)}
              >
                <span className="schema-prefix">{t.schema}.</span>
                {t.name}
                {t.kind === "VIEW" && <span className="kind">view</span>}
              </div>
            ))}
          </>
        ) : (
          activeId &&
          schemas.length > 0 && (
            <>
              <div className="sidebar-section" style={{ marginTop: 8 }}>
                <span>Schemas</span>
              </div>
              {schemas.map((s) => (
                <div key={s}>
                  <div className="tree-schema" onClick={() => toggle(s)}>
                    <span style={{ color: "var(--text-faint)" }}>
                      {open[s] ? "▾" : "▸"}
                    </span>
                    {s}
                  </div>
                  {open[s]?.map((t) => (
                    <div
                      key={t.name}
                      className="tree-table"
                      title={`${t.name} · ${t.kind}`}
                      onClick={() => onPickTable(s, t.name)}
                    >
                      {t.name}
                      {t.kind === "VIEW" && <span className="kind">view</span>}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )
        )}
      </div>
    </aside>
  );
}
