import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ColumnInfo, FilterCondition, FilterOp, QueryResult } from "../types";
import { renderValue } from "../lib/format";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { RowDetailPanel } from "./RowDetailPanel";

interface Props {
  result: QueryResult | null;
  error: string | null;
  editable: boolean;
  canFilter: boolean;
  filters: FilterCondition[];
  onCellEdit: (rowIndex: number, column: string, value: string | null) => void;
  onDeleteRow: (rowIndex: number) => Promise<boolean>;
  onAddFilter: (column: string, op: FilterOp, value: string | null) => void;
  onSetColumnFilter: (column: string, op: FilterOp, value: string | null) => void;
}

// Operators offered in each column header's filter dropdown.
const HEADER_OPS: { op: FilterOp; label: string; title: string }[] = [
  { op: "=", label: "=", title: "equals" },
  { op: "!=", label: "≠", title: "not equals" },
  { op: "<", label: "<", title: "less than" },
  { op: ">", label: ">", title: "greater than" },
  { op: "<=", label: "≤", title: "less than or equal" },
  { op: ">=", label: "≥", title: "greater than or equal" },
  { op: "like", label: "⊃", title: "contains" },
  { op: "is null", label: "∅", title: "is null" },
  { op: "is not null", label: "≠∅", title: "is not null" },
];

const VALUELESS = (op: FilterOp) => op === "is null" || op === "is not null";

const ROW_H = 26;
const COL_W = 180;
const GUTTER_W = 56;

function truncate(s: string, n = 40) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

type SortDir = "asc" | "desc";

// Order-only comparator over raw cell values: nulls sink to the bottom,
// numbers compare numerically, everything else compares as text with natural
// ("2" < "10") ordering.
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = typeof a === "object" ? JSON.stringify(a) : String(a);
  const bs = typeof b === "object" ? JSON.stringify(b) : String(b);
  return as.localeCompare(bs, undefined, { numeric: true });
}

export function ResultsGrid({
  result,
  error,
  editable,
  canFilter,
  filters,
  onCellEdit,
  onDeleteRow,
  onAddFilter,
  onSetColumnFilter,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [detailRow, setDetailRow] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; column: string; value: unknown } | null>(
    null
  );
  const [sort, setSort] = useState<{ column: string; dir: SortDir } | null>(null);
  // Per-column header filter inputs. Kept in sync with the applied `filters`
  // (below) so removing a chip elsewhere also clears the matching header input.
  const [draftOp, setDraftOp] = useState<Record<string, FilterOp>>({});
  const [draftValue, setDraftValue] = useState<Record<string, string>>({});

  // A fresh result set may not share columns with the old one — drop any stale
  // sort so we never index rows by a column that no longer exists.
  useEffect(() => {
    setSort(null);
  }, [result]);

  useEffect(() => {
    const ops: Record<string, FilterOp> = {};
    const vals: Record<string, string> = {};
    for (const f of filters) {
      ops[f.column] = f.op;
      vals[f.column] = f.value ?? "";
    }
    setDraftOp(ops);
    setDraftValue(vals);
  }, [filters]);

  function applyHeaderFilter(column: string) {
    const op = draftOp[column] ?? "=";
    if (VALUELESS(op)) {
      onSetColumnFilter(column, op, null);
      return;
    }
    const val = draftValue[column] ?? "";
    onSetColumnFilter(column, op, val === "" ? null : val);
  }

  function changeHeaderOp(column: string, op: FilterOp) {
    setDraftOp((o) => ({ ...o, [column]: op }));
    // Valueless operators take effect immediately; value ops wait for Enter so
    // we don't re-run the query on every keystroke.
    if (VALUELESS(op)) onSetColumnFilter(column, op, null);
    else if ((draftValue[column] ?? "") !== "") onSetColumnFilter(column, op, draftValue[column]);
  }

  // Display order as indices into `result.rows`; identity order when unsorted.
  // Editing/deleting/detail all resolve through this so they hit the right row.
  const order = useMemo(() => {
    const n = result?.rows.length ?? 0;
    const idx = Array.from({ length: n }, (_, i) => i);
    if (!result || !sort) return idx;
    const rows = result.rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return idx.sort((a, b) => {
      const cmp = compareValues(rows[a][sort.column], rows[b][sort.column]);
      // Stable tie-break on original position keeps equal rows from jittering.
      return cmp !== 0 ? sign * cmp : a - b;
    });
  }, [result, sort]);

  function toggleSort(column: string) {
    // Cycle: unsorted → asc → desc → unsorted.
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  }

  const rowVirtualizer = useVirtualizer({
    count: result?.rows.length ?? 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 20,
  });

  function startEdit(rowIndex: number, col: string, current: unknown) {
    if (!editable) return;
    const { text, isNull } = renderValue(current);
    setEditingCell({ row: rowIndex, col });
    setEditValue(isNull ? "" : text);
  }

  function commitEdit(value: string | null) {
    if (!editingCell) return;
    onCellEdit(editingCell.row, editingCell.col, value);
    setEditingCell(null);
  }

  function contextMenuItems(): MenuItem[] {
    if (!contextMenu) return [];
    const { column, value } = contextMenu;
    const items: MenuItem[] = [
      { label: "Copy value", onClick: () => navigator.clipboard.writeText(renderValue(value).text) },
    ];
    if (canFilter) {
      if (value === null || value === undefined) {
        items.push({ label: `Filter: "${column}" IS NULL`, onClick: () => onAddFilter(column, "is null", null) });
        items.push({
          label: `Filter: "${column}" IS NOT NULL`,
          onClick: () => onAddFilter(column, "is not null", null),
        });
      } else {
        const text = truncate(renderValue(value).text);
        items.push({ label: `Filter: ${column} = ${text}`, onClick: () => onAddFilter(column, "=", renderValue(value).text) });
        items.push({
          label: `Filter: ${column} ≠ ${text}`,
          onClick: () => onAddFilter(column, "!=", renderValue(value).text),
        });
      }
    }
    return items;
  }

  if (error) {
    return (
      <div className="results">
        <div className="grid-error">{error}</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="results">
        <div className="grid-empty">Run a query with ⌘↵ to see results.</div>
      </div>
    );
  }

  if (result.columns.length === 0) {
    return (
      <div className="results">
        <div className="grid-empty">
          OK · {result.rows_affected} row{result.rows_affected === 1 ? "" : "s"} affected
          · {result.duration_ms} ms
        </div>
      </div>
    );
  }

  const gridWidth = GUTTER_W + result.columns.length * COL_W;
  const columns: ColumnInfo[] = result.columns;

  return (
    <div className="results" ref={parentRef}>
      <div className="grid" style={{ width: gridWidth }}>
        <div className="grid-head">
          <div className="cell gutter" style={{ width: GUTTER_W, minWidth: GUTTER_W }}>
            #
          </div>
          {columns.map((c) => {
            const op = draftOp[c.name] ?? "=";
            const active = filters.some((f) => f.column === c.name);
            return (
              <div key={c.name} className="cell" style={{ width: COL_W, minWidth: COL_W }}>
                <div className="col-head sortable" title={`${c.name} — sort`} onClick={() => toggleSort(c.name)}>
                  <span className="col-name">
                    <span className="col-name-text">{c.name}</span>
                    {sort?.column === c.name && (
                      <span className="sort-arrow">{sort.dir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </span>
                  <span className="type">{c.data_type}</span>
                </div>
                {canFilter && (
                  <div
                    className={`col-filter ${active ? "active" : ""}`}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <select
                      className="col-filter-op"
                      value={op}
                      title="Filter operator"
                      onChange={(e) => changeHeaderOp(c.name, e.target.value as FilterOp)}
                    >
                      {HEADER_OPS.map((o) => (
                        <option key={o.op} value={o.op} title={o.title}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="col-filter-input"
                      placeholder={VALUELESS(op) ? "—" : "filter…"}
                      value={VALUELESS(op) ? "" : draftValue[c.name] ?? ""}
                      disabled={VALUELESS(op)}
                      autoCorrect="off"
                      autoCapitalize="off"
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(e) => setDraftValue((v) => ({ ...v, [c.name]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyHeaderFilter(c.name);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((vRow) => {
            const dataIndex = order[vRow.index];
            const row = result.rows[dataIndex];
            return (
              <div
                key={vRow.key}
                className="grid-row"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vRow.start}px)`,
                }}
              >
                <div
                  className="cell gutter"
                  style={{ width: GUTTER_W, minWidth: GUTTER_W }}
                  title="View row details"
                  onClick={() => setDetailRow(dataIndex)}
                >
                  {dataIndex + 1}
                </div>
                {columns.map((c) => {
                  const isEditing = editingCell?.row === dataIndex && editingCell.col === c.name;
                  const { text, isNull } = renderValue(row[c.name]);

                  if (isEditing) {
                    return (
                      <div
                        key={c.name}
                        className="cell editing"
                        style={{ width: COL_W, minWidth: COL_W }}
                      >
                        <input
                          autoFocus
                          className="cell-input"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => setEditingCell(null)}
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                              e.preventDefault();
                              commitEdit(editValue);
                            } else if (e.key === "Enter") commitEdit(editValue);
                            else if (e.key === "Escape") setEditingCell(null);
                          }}
                        />
                        <button
                          className="cell-null-btn"
                          title="Set to NULL"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitEdit(null);
                          }}
                        >
                          ∅
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={c.name}
                      className={`cell ${isNull ? "null" : ""} ${editable ? "editable" : ""}`}
                      style={{ width: COL_W, minWidth: COL_W }}
                      title={text}
                      onDoubleClick={() => startEdit(dataIndex, c.name, row[c.name])}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, column: c.name, value: row[c.name] });
                      }}
                    >
                      {text}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {detailRow !== null && result.rows[detailRow] && (
        <RowDetailPanel
          row={result.rows[detailRow]}
          rowIndex={detailRow}
          totalRows={result.rows.length}
          columns={columns}
          editable={editable}
          onClose={() => setDetailRow(null)}
          onNavigate={(delta) => setDetailRow((r) => Math.max(0, Math.min(result.rows.length - 1, (r ?? 0) + delta)))}
          onCellEdit={onCellEdit}
          onDeleteRow={onDeleteRow}
        />
      )}

      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenuItems()} onClose={() => setContextMenu(null)} />
      )}
    </div>
  );
}
