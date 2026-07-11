import { useEffect, useState } from "react";
import type { ColumnInfo } from "../types";
import { renderValue } from "../lib/format";

interface Props {
  row: Record<string, unknown>;
  rowIndex: number;
  totalRows: number;
  columns: ColumnInfo[];
  editable: boolean;
  onClose: () => void;
  onNavigate: (delta: 1 | -1) => void;
  onCellEdit: (rowIndex: number, column: string, value: string | null) => void;
  /** Resolves to whether the row was actually deleted (false if the user cancelled the confirm). */
  onDeleteRow: (rowIndex: number) => Promise<boolean>;
}

export function RowDetailPanel({
  row,
  rowIndex,
  totalRows,
  columns,
  editable,
  onClose,
  onNavigate,
  onCellEdit,
  onDeleteRow,
}: Props) {
  const [editingCol, setEditingCol] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    // A new row was navigated to — drop any in-progress edit for the old one.
    setEditingCol(null);
  }, [rowIndex]);

  const query = search.trim().toLowerCase();
  const visibleColumns = query
    ? columns.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          renderValue(row[c.name]).text.toLowerCase().includes(query)
      )
    : columns;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editingCol) setEditingCol(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingCol, onClose]);

  function startEdit(column: string, current: unknown) {
    if (!editable) return;
    const { text, isNull } = renderValue(current);
    setEditingCol(column);
    setEditValue(isNull ? "" : text);
  }

  function commitEdit(value: string | null) {
    if (!editingCol) return;
    onCellEdit(rowIndex, editingCol, value);
    setEditingCol(null);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="row-detail" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row-detail-header">
          <span>
            Row {rowIndex + 1} of {totalRows}
          </span>
          <div className="row-detail-nav">
            <button disabled={rowIndex <= 0} onClick={() => onNavigate(-1)} title="Previous row">
              ‹
            </button>
            <button disabled={rowIndex >= totalRows - 1} onClick={() => onNavigate(1)} title="Next row">
              ›
            </button>
            <button className="row-detail-close" onClick={onClose} title="Close">
              ×
            </button>
          </div>
        </div>

        <div className="row-detail-search">
          <input
            type="text"
            placeholder="Search columns & values…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Clear the filter first; only let a second Escape close the panel.
              if (e.key === "Escape" && search) {
                e.stopPropagation();
                setSearch("");
              }
            }}
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="row-detail-body">
          {visibleColumns.length === 0 && (
            <div className="detail-empty">No columns match “{search}”.</div>
          )}
          {visibleColumns.map((c) => {
            const { text, isNull } = renderValue(row[c.name]);
            const isEditing = editingCol === c.name;
            return (
              <div className="detail-field" key={c.name}>
                <div className="detail-label">
                  <span>{c.name}</span>
                  <span className="type">{c.data_type}</span>
                </div>
                {isEditing ? (
                  <div className="detail-value editing">
                    <textarea
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                          e.preventDefault();
                          commitEdit(editValue);
                        } else if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          commitEdit(editValue);
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setEditingCol(null);
                        }
                      }}
                      onBlur={() => setEditingCol(null)}
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
                ) : (
                  <div
                    className={`detail-value ${isNull ? "null" : ""} ${editable ? "editable" : ""}`}
                    onClick={() => startEdit(c.name, row[c.name])}
                  >
                    {text}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {editable && (
          <div className="row-detail-footer">
            <button
              className="btn danger"
              onClick={async () => {
                // window.confirm (inside onDeleteRow) is synchronous, so this
                // await returns only after the user has answered it — closing
                // the panel here never races ahead of a still-pending confirm.
                if (await onDeleteRow(rowIndex)) onClose();
              }}
            >
              Delete row
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
