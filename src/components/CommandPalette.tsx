import { useEffect, useMemo, useRef, useState } from "react";
import type { SavedConnection, TableRef } from "../types";
import { api } from "../api";

interface Props {
  open: boolean;
  connections: SavedConnection[];
  activeId: string | null;
  onClose: () => void;
  onOpenTable: (schema: string, table: string) => void;
  onSelectConnection: (conn: SavedConnection) => void;
  onNewTab: () => void;
  onCloseTab: () => void;
  onRun: () => void;
  onAddConnection: () => void;
}

interface Command {
  id: string;
  label: string;
  hint?: string;
  section: string;
  run: () => void;
}

// Subsequence match: "ntb" matches "New tab". Case-insensitive.
function fuzzy(text: string, q: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q) {
    i = t.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export function CommandPalette({
  open,
  connections,
  activeId,
  onClose,
  onOpenTable,
  onSelectConnection,
  onNewTab,
  onCloseTab,
  onRun,
  onAddConnection,
}: Props) {
  const [search, setSearch] = useState("");
  const [tables, setTables] = useState<TableRef[]>([]);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset transient state each time the palette opens.
  useEffect(() => {
    if (open) {
      setSearch("");
      setTables([]);
      setSelected(0);
    }
  }, [open]);

  // Table search runs on the backend (same fast path as the sidebar), debounced.
  useEffect(() => {
    const q = search.trim();
    if (!open || !activeId || !q) {
      setTables([]);
      return;
    }
    const id = activeId;
    const timer = setTimeout(() => {
      api
        .searchTables(id, q)
        .then((res) => id === activeId && setTables(res.slice(0, 20)))
        .catch(() => setTables([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [search, activeId, open]);

  const commands = useMemo<Command[]>(() => {
    const q = search.trim().toLowerCase();

    const tableCmds: Command[] = tables.map((t) => ({
      id: `tbl-${t.schema}.${t.name}`,
      label: `${t.schema}.${t.name}`,
      hint: t.kind === "VIEW" ? "View" : "Table",
      section: "Tables",
      run: () => onOpenTable(t.schema, t.name),
    }));

    const connCmds: Command[] = connections
      .filter((c) => fuzzy(`switch to ${c.name} connection`, q))
      .map((c) => ({
        id: `conn-${c.id}`,
        label: `Switch to ${c.name}`,
        hint: c.id === activeId ? "Active" : "Connection",
        section: "Connections",
        run: () => onSelectConnection(c),
      }));

    const raw: Command[] = [];
    if (activeId) {
      raw.push({ id: "new-tab", label: "New query tab", hint: "⌘T", section: "Actions", run: onNewTab });
      raw.push({ id: "run", label: "Run query", hint: "⌘↵", section: "Actions", run: onRun });
      raw.push({ id: "close-tab", label: "Close current tab", hint: "⌘W", section: "Actions", run: onCloseTab });
    }
    raw.push({ id: "add-conn", label: "Add connection…", section: "Actions", run: onAddConnection });
    const actionCmds = raw.filter((c) => fuzzy(c.label, q));

    return [...tableCmds, ...connCmds, ...actionCmds];
  }, [search, tables, connections, activeId, onOpenTable, onSelectConnection, onNewTab, onRun, onCloseTab, onAddConnection]);

  // Keep the selection valid as the list shrinks/grows.
  useEffect(() => {
    setSelected((s) => Math.min(s, Math.max(0, commands.length - 1)));
  }, [commands.length]);

  // Scroll the active row into view on arrow navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  function runAt(idx: number) {
    const cmd = commands[idx];
    if (!cmd) return;
    cmd.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(commands.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(selected);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastSection = "";

  return (
    <div className="cmdk-overlay" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Search tables, connections, actions…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onKeyDown}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="cmdk-list" ref={listRef}>
          {commands.length === 0 ? (
            <div className="cmdk-empty">No matches</div>
          ) : (
            commands.map((cmd, i) => {
              const header = cmd.section !== lastSection ? cmd.section : null;
              lastSection = cmd.section;
              return (
                <div key={cmd.id}>
                  {header && <div className="cmdk-section">{header}</div>}
                  <button
                    data-idx={i}
                    className={`cmdk-item ${i === selected ? "selected" : ""}`}
                    onMouseMove={() => setSelected(i)}
                    onClick={() => runAt(i)}
                  >
                    <span className="cmdk-label">{cmd.label}</span>
                    {cmd.hint && <span className="cmdk-hint">{cmd.hint}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
