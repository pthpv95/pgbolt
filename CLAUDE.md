# CLAUDE.md

Guidance for working in this repo. See `README.md` for user-facing feature docs.

## What this is

**pgbolt** — a fast, native Postgres GUI for macOS. Tauri (Rust) + React/TypeScript.
Rust owns connection pools and query execution (via `sqlx`); the webview is only UI.

**The guiding principle is speed.** Every feature must avoid unbounded work and
must not add heavy dependencies. Concretely:
- Results are virtualized (`@tanstack/react-virtual`) — never render all rows.
- Table queries are `LIMIT`-bounded; introspection is single-query where possible.
- No heavy libs (no Monaco, no grid library, no charting/ORM). The grid is
  hand-rolled on purpose. Keep the bundle lean (it's ~630KB, almost all CodeMirror).
- Prefer one indexed `information_schema` query over N per-object calls.

## Commands

```bash
npm run tauri dev     # dev app (Vite HMR for UI + Rust backend, first build is slow)
npm run build         # tsc typecheck + vite production build (frontend only)
npx tsc --noEmit      # fast frontend typecheck — run after every TS change
npm run tauri build   # release .app bundle
```

**Environment gotcha:** `cargo` lives at `~/.cargo/bin` and is often NOT on the
non-interactive shell PATH. Prefix Tauri commands: `export PATH="$HOME/.cargo/bin:$PATH"`.

**Dev loop:** `tauri dev` watches `src-tauri/` and auto-recompiles the Rust
backend on any `.rs` or capabilities change (~few seconds), relaunching the app.
Frontend changes hot-reload via Vite. After editing TS, run `npx tsc --noEmit`;
after editing Rust, watch the dev output for `Finished`/`Running` (or a compile error).

## Architecture

```
src/                        React UI
  App.tsx                   top-level state: connections, tabs, filters, zoom,
                            editor height, schema-map cache, global shortcuts
  api.ts                    typed invoke() wrappers — one fn per Rust command
  types.ts                  shared TS types (mirror the Rust serde structs)
  components/
    Sidebar.tsx             connection list + schema/table tree + table search
    SqlEditor.tsx           CodeMirror; schema-aware autocomplete; resizable height
    ResultsGrid.tsx         virtualized grid: sort, per-column filters, inline edit
    RowDetailPanel.tsx      full-row modal: column/value search, edit, delete
    TabBar.tsx              query tabs + right-click close menu
    CommandPalette.tsx      ⌘K launcher (tables/connections/actions)
    ContextMenu.tsx         reusable positioned menu
    ConnectionManager.tsx   add/edit connection modal
  lib/format.ts             renderValue(): unknown cell value -> { text, isNull }
src-tauri/src/
  db.rs                     connection registry (AppState) + all #[tauri::command]s
  convert.rs                PgRow -> serde_json::Value (dynamic type decoder)
  lib.rs                    invoke_handler registration
  capabilities/default.json Tauri v2 permissions (see drag-region note below)
```

### Adding a backend command (the 4-file pattern)

1. `src-tauri/src/db.rs` — write the `#[tauri::command] pub async fn`, plus any
   `#[derive(Serialize)]` result struct.
2. `src-tauri/src/lib.rs` — add it to `tauri::generate_handler![...]`.
3. `src/api.ts` — add a typed `invoke<T>("snake_case_name", { camelCaseArgs })`.
   Note: Tauri auto-maps camelCase JS args to snake_case Rust params.
4. `src/types.ts` — add the matching TS type mirroring the serde struct.

## Key patterns & conventions

- **Tab model:** `QueryTab` holds its own sql/result/error/filters/tableRef/pkColumns.
  Tabs are scoped to a connection (`connId`); `visibleTabs` filters to the active one.
- **Editable detection:** a result is editable only if it maps to a real table with
  a primary key — either opened from the sidebar or matched by `detectTableRef` (a
  plain `SELECT … FROM [schema.]table`, no join/group/union/distinct). `pkColumns`:
  `null` = not fetched, `[]` = no PK (read-only).
- **Filters** re-run the query server-side by rebuilding SQL in `buildTableSql`
  (`App.tsx`). Values are spliced as escaped SQL string literals (Postgres coerces
  to the column type), NOT bound params — matches the existing approach; keep it
  consistent if extending. Header filters (per-column) and the right-click cell
  menu both feed the same `filters` array; chips render above the grid.
- **Sorting** in `ResultsGrid` is client-side over loaded rows only, via an `order`
  array of indices into `result.rows`. All row ops (edit/delete/detail) resolve
  through `order`, so they hit the right underlying row. (If you add pagination,
  move sort server-side to `ORDER BY`.)
- **Autocomplete schema:** `App` fetches `list_columns` once per connection into a
  `schema→table→columns` map (`SchemaMap`), cached in `schemaMaps` state, and feeds
  it to CodeMirror's `sql({ schema })`. Rebuilt only when the map changes.
- **Shortcuts** live in a single `keydown` effect in `App.tsx`: ⌘T new tab, ⌘W close
  tab, ⌘K palette, ⌘+/-/0 zoom. That effect depends on `[activeId, activeTabId, tabs]`
  so the closures aren't stale.

## Gotchas

- **Window dragging needs a permission.** `data-tauri-drag-region` (the titlebar)
  requires `core:window:allow-start-dragging` in `capabilities/default.json`. The
  `-webkit-app-region: drag` CSS is an Electron concept and is a **no-op** in macOS
  WKWebView — don't rely on it.
- **Zoom uses WebKit `zoom`**, not `transform: scale` (so 100%-height panes stay
  correct). Any pixel-delta math from pointer events (e.g. the editor resize handle)
  must divide by `zoom` to convert viewport px back to layout px.
- **Empty-columns result:** columns are read off the first row, so a `SELECT`
  returning zero rows shows no columns.
- **Passwords are stored in `localStorage` in plaintext** — fine for local dev only.
- Frontend types must be kept in sync by hand with the Rust serde structs.
