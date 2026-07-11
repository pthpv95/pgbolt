import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnInfo, FilterOp } from "../types";

// Searchable "add filter" popover: pick any column by name (no horizontal
// scrolling to reach far-right columns), choose an operator, type a value.
// Writes through the same per-column filter path as the header inputs.

const OPS: { op: FilterOp; label: string }[] = [
  { op: "=", label: "= equals" },
  { op: "!=", label: "≠ not equals" },
  { op: "like", label: "⊃ contains" },
  { op: "<", label: "< less than" },
  { op: ">", label: "> greater than" },
  { op: "<=", label: "≤ less or equal" },
  { op: ">=", label: "≥ greater or equal" },
  { op: "is null", label: "∅ is null" },
  { op: "is not null", label: "≠∅ is not null" },
];

const VALUELESS = (op: FilterOp) => op === "is null" || op === "is not null";
const TEXTISH = /char|text|json|uuid|name|bytea/i;

interface Props {
  columns: ColumnInfo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (column: string, op: FilterOp, value: string | null) => void;
}

export function AddFilter({ columns, open, onOpenChange, onApply }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [picked, setPicked] = useState<ColumnInfo | null>(null);
  const [op, setOp] = useState<FilterOp>("=");
  const [value, setValue] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.name.toLowerCase().includes(q));
  }, [columns, query]);

  useEffect(() => setHighlight(0), [query]);

  function reset() {
    setQuery("");
    setPicked(null);
    setOp("=");
    setValue("");
    setHighlight(0);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  // Focus the search box when the popover opens; refocus it when we step back
  // to column selection.
  useEffect(() => {
    if (open && !picked) searchRef.current?.focus();
  }, [open, picked]);

  // Focus the value input after picking a column (unless the op takes no value).
  useEffect(() => {
    if (picked && !VALUELESS(op)) valueRef.current?.focus();
  }, [picked, op]);

  // Reset internal state whenever the popover is closed from outside.
  useEffect(() => {
    if (!open) reset();
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(c: ColumnInfo) {
    setPicked(c);
    // A sensible default operator so common cases need one keystroke fewer.
    setOp(TEXTISH.test(c.data_type) ? "like" : "=");
  }

  function apply() {
    if (!picked) return;
    if (VALUELESS(op)) {
      onApply(picked.name, op, null);
      close();
      return;
    }
    if (value === "") return;
    onApply(picked.name, op, value);
    close();
  }

  if (!open) {
    return (
      <button className="add-filter-btn" onClick={() => onOpenChange(true)} title="Add filter (⌘F)">
        + Filter
      </button>
    );
  }

  return (
    <div className="add-filter" ref={rootRef}>
      <button className="add-filter-btn open" onClick={close}>
        + Filter
      </button>
      <div className="add-filter-pop">
        {!picked ? (
          <>
            <input
              ref={searchRef}
              className="add-filter-search"
              placeholder="Filter which column…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHighlight((h) => Math.min(h + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHighlight((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (matches[highlight]) pick(matches[highlight]);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                }
              }}
            />
            <div className="add-filter-list">
              {matches.length === 0 ? (
                <div className="add-filter-empty">No columns match</div>
              ) : (
                matches.map((c, i) => (
                  <button
                    key={c.name}
                    className={`add-filter-col ${i === highlight ? "selected" : ""}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(c)}
                  >
                    <span className="add-filter-col-name">{c.name}</span>
                    <span className="add-filter-col-type">{c.data_type}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="add-filter-form">
            <button className="add-filter-back" onClick={() => setPicked(null)} title="Back to columns">
              ‹ {picked.name}
            </button>
            <div className="add-filter-row">
              <select
                className="add-filter-op"
                value={op}
                onChange={(e) => setOp(e.target.value as FilterOp)}
              >
                {OPS.map((o) => (
                  <option key={o.op} value={o.op}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                ref={valueRef}
                className="add-filter-value"
                placeholder={VALUELESS(op) ? "—" : "value…"}
                value={VALUELESS(op) ? "" : value}
                disabled={VALUELESS(op)}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                  }
                }}
              />
            </div>
            <button className="add-filter-apply" onClick={apply}>
              Apply filter
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
