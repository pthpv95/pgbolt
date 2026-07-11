import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { SqlEditor } from "./components/SqlEditor";
import { ResultsGrid } from "./components/ResultsGrid";
import { ConnectionModal } from "./components/ConnectionManager";
import { TabBar } from "./components/TabBar";
import { CommandPalette } from "./components/CommandPalette";
import { AddFilter } from "./components/AddFilter";
import { api } from "./api";
import type { ColumnValue, FilterCondition, FilterOp, QueryTab, SavedConnection, SchemaMap } from "./types";

const STORE_KEY = "pgbolt.connections";
const ZOOM_KEY = "pgbolt.zoom";
const EDITOR_H_KEY = "pgbolt.editorHeight";

const MIN_EDITOR_H = 80;
const MAX_EDITOR_H = 600;

function loadConnections(): SavedConnection[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function blankTab(connId: string): QueryTab {
  return {
    id: crypto.randomUUID(),
    connId,
    title: "New Query",
    sql: 'SELECT * FROM "";',
    result: null,
    error: null,
    running: false,
    tableRef: null,
    pkColumns: null,
    filters: [],
  };
}

const OP_SQL: Record<Exclude<FilterOp, "is null" | "is not null" | "like">, string> = {
  "=": "=",
  "!=": "<>",
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
};

function buildTableSql(ref: { schema: string; table: string }, filters: FilterCondition[]): string {
  let sql = `SELECT * FROM "${ref.schema}"."${ref.table}"`;
  if (filters.length) {
    const clauses = filters.map((f) => {
      const col = `"${f.column}"`;
      if (f.op === "is null") return `${col} IS NULL`;
      if (f.op === "is not null") return `${col} IS NOT NULL`;
      // Spliced as a SQL string literal, not a bound parameter — Postgres
      // resolves an untyped literal against the column's real type, so this
      // works for numeric/uuid/date/etc. columns too, not just text.
      const escaped = (f.value ?? "").replace(/'/g, "''");
      // `contains` casts to text so it works on any column type.
      if (f.op === "like") return `${col}::text ILIKE '%${escaped}%'`;
      return `${col} ${OP_SQL[f.op]} '${escaped}'`;
    });
    sql += `\nWHERE ${clauses.join(" AND ")}`;
  }
  sql += `\nLIMIT 200;`;
  return sql;
}

// Best-effort: does this look like a plain `SELECT … FROM [schema.]table …`
// with no join/aggregation, so it's safe to treat as an editable table view?
// Same "good enough" spirit as the row-vs-command heuristic in db.rs.
const TABLE_REF_RE =
  /^\s*select\s+[\s\S]*?\bfrom\s+"?([a-zA-Z_]\w*)"?(?:\."?([a-zA-Z_]\w*)"?)?/i;
const DISQUALIFYING_RE = /\b(join|group\s+by|union|distinct)\b/i;

function detectTableRef(sql: string): { schema: string; table: string } | null {
  if (DISQUALIFYING_RE.test(sql)) return null;
  const m = TABLE_REF_RE.exec(sql);
  if (!m) return null;
  return m[2] ? { schema: m[1], table: m[2] } : { schema: "public", table: m[1] };
}

const FILTER_OP_LABEL: Record<FilterCondition["op"], string> = {
  "=": "=",
  "!=": "≠",
  "<": "<",
  ">": ">",
  "<=": "≤",
  ">=": "≥",
  like: "⊃",
  "is null": "IS NULL",
  "is not null": "IS NOT NULL",
};

function stringifyValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function App() {
  const [connections, setConnections] = useState<SavedConnection[]>(loadConnections);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConn, setEditingConn] = useState<SavedConnection | null>(null);

  const [tabs, setTabs] = useState<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const [zoom, setZoom] = useState(() => Number(localStorage.getItem(ZOOM_KEY)) || 1);
  const [editorHeight, setEditorHeight] = useState(
    () => Number(localStorage.getItem(EDITOR_H_KEY)) || 150
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addFilterOpen, setAddFilterOpen] = useState(false);
  // schema→table→columns per connection, seeded once for editor autocomplete.
  const [schemaMaps, setSchemaMaps] = useState<Record<string, SchemaMap>>({});

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(connections));
  }, [connections]);

  useEffect(() => {
    localStorage.setItem(EDITOR_H_KEY, String(editorHeight));
  }, [editorHeight]);

  useEffect(() => {
    localStorage.setItem(ZOOM_KEY, String(zoom));
    // `zoom` is a WebKit property (this app only ships for macOS/WKWebView) —
    // it reflows layout, unlike `transform: scale`, so 100%-height panes stay correct.
    (document.body.style as unknown as { zoom: string }).zoom = String(zoom);
  }, [zoom]);

  useEffect(() => {
    // Suppress the webview's native right-click menu (reload/inspect/back) so
    // the app feels like a native desktop tool. Editable areas keep it so
    // copy/paste still works; the app's own menus run via React handlers.
    function onContextMenu(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, [contenteditable="true"], .cm-editor')) return;
      e.preventDefault();
    }
    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setZoom((z) => Math.min(1.6, Math.round((z + 0.1) * 10) / 10));
      } else if (e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(0.7, Math.round((z - 0.1) * 10) / 10));
      } else if (e.key === "0") {
        e.preventDefault();
        setZoom(1);
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        newTab();
      } else if (e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key.toLowerCase() === "f") {
        // ⌘F: open the searchable "add filter" popover for the active table.
        if (activeTab?.tableRef) {
          e.preventDefault();
          setAddFilterOpen((o) => !o);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `newTab`/`closeTab` close over `activeId`, `tabs` and `activeTabId`;
    // re-subscribe whenever they change so ⌘T/⌘W always act on the current
    // connection and tab, never a stale one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeTabId, tabs]);

  // Seed autocomplete for the active connection (once, then cached). One
  // indexed query over information_schema.columns — cheap even on big DBs.
  useEffect(() => {
    if (!activeId || schemaMaps[activeId]) return;
    const id = activeId;
    api
      .listColumns(id)
      .then((cols) => {
        const map: SchemaMap = {};
        for (const c of cols) {
          const tables = (map[c.schema] ??= {});
          (tables[c.table] ??= []).push(c.column);
        }
        setSchemaMaps((prev) => ({ ...prev, [id]: map }));
      })
      .catch(() => {});
  }, [activeId, schemaMaps]);

  const visibleTabs = tabs.filter((t) => t.connId === activeId);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  function patchTab(id: string, patch: Partial<QueryTab>) {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function activateConnection(connId: string) {
    setActiveId(connId);
    const existing = tabs.filter((t) => t.connId === connId);
    if (existing.length > 0) {
      setActiveTabId(existing[existing.length - 1].id);
    } else {
      const tab = blankTab(connId);
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    }
  }

  async function selectConnection(conn: SavedConnection) {
    setConnError(null);
    try {
      // Re-open the pool on the backend (a fresh app start has none).
      await api.connect(conn.id, conn);
      activateConnection(conn.id);
    } catch (e) {
      setConnError(String(e));
    }
  }

  function saveConnection(conn: SavedConnection) {
    // ConnectionModal already called api.connect (with the same id, so this
    // just replaces the pool for that id) to test the credentials.
    setConnections((prev) =>
      prev.some((c) => c.id === conn.id) ? prev.map((c) => (c.id === conn.id ? conn : c)) : [...prev, conn]
    );
    setModalOpen(false);
    setEditingConn(null);
    activateConnection(conn.id);
  }

  async function deleteConnection(id: string) {
    await api.disconnect(id).catch(() => {});
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setTabs((prev) => prev.filter((t) => t.connId !== id));
    if (activeId === id) {
      setActiveId(null);
      setActiveTabId(null);
    }
    setModalOpen(false);
    setEditingConn(null);
  }

  async function executeTab(tab: QueryTab, sql: string) {
    patchTab(tab.id, { running: true, error: null });
    try {
      const res = await api.runQuery(tab.connId, sql);
      patchTab(tab.id, { result: res, running: false });

      let ref = tab.tableRef;
      if (!ref) {
        ref = detectTableRef(sql);
        if (ref) patchTab(tab.id, { tableRef: ref });
      }
      if (ref) {
        const pk = await api.primaryKeys(tab.connId, ref.schema, ref.table).catch(() => []);
        patchTab(tab.id, { pkColumns: pk });
      }
    } catch (e) {
      patchTab(tab.id, { error: String(e), result: null, running: false });
    }
  }

  function runTab(tabId: string) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.running) return;
    executeTab(tab, tab.sql);
  }

  function setTabSql(id: string, sql: string) {
    // Hand-editing the query invalidates any filter chips — they only ever
    // represent SQL that the filter machinery itself produced.
    patchTab(id, { sql, filters: [] });
  }

  function newTab() {
    if (!activeId) return;
    const tab = blankTab(activeId);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function closeTab(id: string) {
    const closing = tabs.find((t) => t.id === id);
    if (!closing) return;
    let remaining = tabs.filter((t) => t.id !== id);
    let nextActive = activeTabId;
    if (activeTabId === id) {
      const sameConn = remaining.filter((t) => t.connId === closing.connId);
      if (sameConn.length > 0) {
        nextActive = sameConn[sameConn.length - 1].id;
      } else {
        const fresh = blankTab(closing.connId);
        remaining = [...remaining, fresh];
        nextActive = fresh.id;
      }
    }
    setTabs(remaining);
    setActiveTabId(nextActive);
  }

  // Close every tab of the active connection matching `shouldClose` (indexed
  // within that connection's tab order). Mirrors `closeTab`: keeps the
  // connection from going empty and re-points the active tab if it was closed.
  function closeTabsWhere(shouldClose: (index: number) => boolean) {
    if (!activeId) return;
    const connTabs = tabs.filter((t) => t.connId === activeId);
    const closeIds = new Set(connTabs.filter((_, i) => shouldClose(i)).map((t) => t.id));
    if (closeIds.size === 0) return;
    let remaining = tabs.filter((t) => !closeIds.has(t.id));
    let sameConn = remaining.filter((t) => t.connId === activeId);
    if (sameConn.length === 0) {
      const fresh = blankTab(activeId);
      remaining = [...remaining, fresh];
      sameConn = [fresh];
    }
    let nextActive = activeTabId;
    if (activeTabId && closeIds.has(activeTabId)) {
      nextActive = sameConn[sameConn.length - 1].id;
    }
    setTabs(remaining);
    setActiveTabId(nextActive);
  }

  function closeOtherTabs(id: string) {
    const idx = tabs.filter((t) => t.connId === activeId).findIndex((t) => t.id === id);
    if (idx < 0) return;
    closeTabsWhere((i) => i !== idx);
  }

  function closeTabsToLeft(id: string) {
    const idx = tabs.filter((t) => t.connId === activeId).findIndex((t) => t.id === id);
    if (idx < 0) return;
    closeTabsWhere((i) => i < idx);
  }

  function closeTabsToRight(id: string) {
    const idx = tabs.filter((t) => t.connId === activeId).findIndex((t) => t.id === id);
    if (idx < 0) return;
    closeTabsWhere((i) => i > idx);
  }

  async function openTable(schema: string, table: string) {
    if (!activeId) return;
    const existing = tabs.find(
      (t) => t.connId === activeId && t.tableRef?.schema === schema && t.tableRef?.table === table
    );
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const sql = `SELECT * FROM "${schema}"."${table}"\nLIMIT 200;`;
    const tab: QueryTab = {
      id: crypto.randomUUID(),
      connId: activeId,
      title: table,
      sql,
      result: null,
      error: null,
      running: false,
      tableRef: { schema, table },
      pkColumns: null,
      filters: [],
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    await executeTab(tab, sql);
  }

  async function handleCellEdit(rowIndex: number, column: string, value: string | null) {
    const tab = activeTab;
    if (!tab?.result || !tab.tableRef || !tab.pkColumns?.length) return;
    const row = tab.result.rows[rowIndex];
    const colInfo = tab.result.columns.find((c) => c.name === column);
    if (!colInfo) return;
    const pk: ColumnValue[] = tab.pkColumns.map((pkCol) => {
      const info = tab.result!.columns.find((c) => c.name === pkCol);
      return { column: pkCol, data_type: info?.data_type ?? "text", value: stringifyValue(row[pkCol]) };
    });
    try {
      const affected = await api.updateRow(
        tab.connId,
        tab.tableRef.schema,
        tab.tableRef.table,
        [{ column, data_type: colInfo.data_type, value }],
        pk
      );
      if (affected === 0) {
        patchTab(tab.id, { error: "No matching row — it may have changed. Cell not updated." });
        return;
      }
      const rows = tab.result.rows.slice();
      rows[rowIndex] = { ...rows[rowIndex], [column]: value };
      patchTab(tab.id, { result: { ...tab.result, rows }, error: null });
    } catch (e) {
      patchTab(tab.id, { error: String(e) });
    }
  }

  async function handleDeleteRow(rowIndex: number): Promise<boolean> {
    const tab = activeTab;
    if (!tab?.result || !tab.tableRef || !tab.pkColumns?.length) return false;
    const row = tab.result.rows[rowIndex];
    const pk: ColumnValue[] = tab.pkColumns.map((pkCol) => {
      const info = tab.result!.columns.find((c) => c.name === pkCol);
      return { column: pkCol, data_type: info?.data_type ?? "text", value: stringifyValue(row[pkCol]) };
    });
    if (!confirm(`Delete this row from "${tab.tableRef.schema}"."${tab.tableRef.table}"?`)) return false;
    try {
      const affected = await api.deleteRow(tab.connId, tab.tableRef.schema, tab.tableRef.table, pk);
      if (affected === 0) {
        patchTab(tab.id, { error: "No matching row — it may already be deleted." });
        return false;
      }
      const rows = tab.result.rows.filter((_, i) => i !== rowIndex);
      patchTab(tab.id, { result: { ...tab.result, rows }, error: null });
      return true;
    } catch (e) {
      patchTab(tab.id, { error: String(e) });
      return false;
    }
  }

  // Drag the divider between the SQL editor and the results grid: moving down
  // grows the editor (shrinks the grid), moving up does the reverse. `zoom`
  // scales layout, so convert the raw pointer delta back into layout pixels.
  function startEditorResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorHeight;
    function onMove(ev: MouseEvent) {
      const dy = (ev.clientY - startY) / zoom;
      setEditorHeight(Math.max(MIN_EDITOR_H, Math.min(MAX_EDITOR_H, startH + dy)));
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function applyFilters(tab: QueryTab, filters: FilterCondition[]) {
    if (!tab.tableRef) return;
    const sql = buildTableSql(tab.tableRef, filters);
    patchTab(tab.id, { filters, sql });
    executeTab({ ...tab, filters, sql }, sql);
  }

  function addFilter(column: string, op: FilterOp, value: string | null) {
    if (!activeTab) return;
    applyFilters(activeTab, [...activeTab.filters, { column, op, value }]);
  }

  function removeFilter(index: number) {
    if (!activeTab) return;
    applyFilters(
      activeTab,
      activeTab.filters.filter((_, i) => i !== index)
    );
  }

  // Header-driven filter: at most one condition per column. An empty value on a
  // value-taking operator clears that column's filter.
  function setColumnFilter(column: string, op: FilterOp, value: string | null) {
    if (!activeTab) return;
    const others = activeTab.filters.filter((f) => f.column !== column);
    const nullOp = op === "is null" || op === "is not null";
    if (!nullOp && (value === null || value === "")) {
      applyFilters(activeTab, others);
      return;
    }
    applyFilters(activeTab, [...others, { column, op, value: nullOp ? null : value }]);
  }

  const editable = !!(activeTab?.tableRef && activeTab.pkColumns && activeTab.pkColumns.length > 0);

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <span className="brand">
          pg<b>bolt</b>
        </span>
        <button className="cmdk-trigger" onClick={() => setPaletteOpen(true)} title="Command palette">
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <div className="body">
        <Sidebar
          connections={connections}
          activeId={activeId}
          connError={connError}
          onSelect={selectConnection}
          onAdd={() => {
            setEditingConn(null);
            setModalOpen(true);
          }}
          onEdit={(conn) => {
            setEditingConn(conn);
            setModalOpen(true);
          }}
          onPickTable={openTable}
        />

        <div className="main">
          {activeId && (
            <TabBar
              tabs={visibleTabs}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
              onClose={closeTab}
              onCloseOthers={closeOtherTabs}
              onCloseLeft={closeTabsToLeft}
              onCloseRight={closeTabsToRight}
              onNew={newTab}
            />
          )}

          <div className="editor-wrap">
            <div className="editor-bar">
              <button
                className="run-btn"
                onClick={() => activeTabId && runTab(activeTabId)}
                disabled={!activeTab || activeTab.running}
              >
                ⚡ Run
              </button>
              <span className="run-hint">⌘↵</span>
              {!editable && activeTab?.tableRef && activeTab.pkColumns?.length === 0 && (
                <span className="readonly-badge" title="No primary key found — inline edit/delete disabled">
                  read-only
                </span>
              )}
              <div className={`latency ${activeTab?.running ? "running" : ""}`}>
                {activeTab?.result && (
                  <>
                    <span className="rows">
                      {activeTab.result.columns.length > 0
                        ? `${activeTab.result.rows.length} rows`
                        : `${activeTab.result.rows_affected} affected`}
                    </span>
                    <span className="ms">{activeTab.result.duration_ms} ms</span>
                  </>
                )}
              </div>
            </div>
            <SqlEditor
              value={activeTab?.sql ?? ""}
              onChange={(v) => activeTab && setTabSql(activeTab.id, v)}
              onRun={() => activeTabId && runTab(activeTabId)}
              disabled={!activeTab || activeTab.running}
              schema={activeId ? schemaMaps[activeId] : undefined}
              height={editorHeight}
            />
          </div>

          <div
            className="editor-resize"
            title="Drag to resize"
            onMouseDown={startEditorResize}
            onDoubleClick={() => setEditorHeight(150)}
          />


          {activeTab?.tableRef && (
            <div className="filter-bar">
              <AddFilter
                columns={activeTab.result?.columns ?? []}
                open={addFilterOpen}
                onOpenChange={setAddFilterOpen}
                onApply={setColumnFilter}
              />
              {activeTab.filters.map((f, i) => (
                <span className="filter-chip" key={i}>
                  {f.column} {FILTER_OP_LABEL[f.op]} {f.value !== null ? `'${f.value}'` : ""}
                  <button onClick={() => removeFilter(i)} title="Remove filter">
                    ×
                  </button>
                </span>
              ))}
              {activeTab.filters.length > 0 && (
                <button className="filter-clear" onClick={() => applyFilters(activeTab, [])}>
                  Clear all
                </button>
              )}
            </div>
          )}

          <ResultsGrid
            result={activeTab?.result ?? null}
            error={activeTab?.error ?? null}
            editable={editable}
            canFilter={!!activeTab?.tableRef}
            filters={activeTab?.filters ?? []}
            onCellEdit={handleCellEdit}
            onDeleteRow={handleDeleteRow}
            onAddFilter={addFilter}
            onSetColumnFilter={setColumnFilter}
          />
        </div>
      </div>

      <CommandPalette
        open={paletteOpen}
        connections={connections}
        activeId={activeId}
        onClose={() => setPaletteOpen(false)}
        onOpenTable={openTable}
        onSelectConnection={selectConnection}
        onNewTab={newTab}
        onCloseTab={() => activeTabId && closeTab(activeTabId)}
        onRun={() => activeTabId && runTab(activeTabId)}
        onAddConnection={() => {
          setEditingConn(null);
          setModalOpen(true);
        }}
      />

      {modalOpen && (
        <ConnectionModal
          initial={editingConn}
          onSave={saveConnection}
          onDelete={editingConn ? () => deleteConnection(editingConn.id) : undefined}
          onClose={() => {
            setModalOpen(false);
            setEditingConn(null);
          }}
        />
      )}
    </div>
  );
}
