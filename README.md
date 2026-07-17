# pgbolt

A ligtning fast, native Postgres GUI for macOS — a TablePlus-shaped starting point built on
Tauri (Rust) + React/TypeScript. I built it for myself to fully customize what I need. :)

Rust owns the connection pools and query
execution; the webview is only the UI.


<img width="721" height="410" alt="image" src="https://github.com/user-attachments/assets/4537640a-010a-458e-8ab3-17807662c94b" />

## Why this stack

- **Tauri, not Electron** — no bundled Chromium, ~10 MB binary vs ~150 MB, and the
  hot path (connect, decode rows, stream to grid) runs in Rust, not JS. This is
  where "lightning fast" comes from.
- **sqlx** for async Postgres, multi-statement execution, and a real connection
  pool per saved connection.
- **@tanstack/react-virtual** so the grid mounts only visible rows. Ad-hoc results
  are capped at 5,000 rows before they reach the UI.

## What works today

### Connections and navigation

- Add, edit, delete, favorite, and locally persist connections; credentials are
  tested before a connection becomes active.
- Browse schemas, tables, and views in a resizable sidebar. Schemas expand by
  default, and backend table search works across schemas.
- Use the **⌘K** command palette to find tables, switch connections, and run
  common actions.
- Window size and position, UI zoom, sidebar width, and editor height persist
  between launches.

### Query workflow

- Multiple query tabs are scoped per connection. Tabs support new/close
  shortcuts and right-click actions for closing other, left, or right tabs.
- The CodeMirror SQL editor has PostgreSQL syntax highlighting, schema-aware
  autocomplete, a high-contrast theme, selectable text, and a resizable height.
- **⌘↵** executes selected SQL when text is selected, or the full editor when it
  is not. The Run button always executes the full editor.
- Single statements and multi-statement scripts such as explicit
  `BEGIN; … COMMIT;` transactions are supported.
- A running query can be stopped. Cancellation targets the exact PostgreSQL
  backend process instead of merely dismissing the UI request.

### Results and table editing

- Row-returning queries render in a virtualized grid; DML/DDL report the total
  affected-row count. Latency and row counts remain visible in the editor bar.
- Ad-hoc results stop at 5,000 rows and display `5000+` with a `limited` badge,
  preventing accidental unbounded results from filling application memory.
- Columns support client-side sorting over loaded rows, drag resizing, and
  double-click reset. The grid scrolls horizontally for wide results.
- Filter from a column header, the searchable **+ Filter** control, or a cell's
  right-click menu. Active filters appear as removable chips and run server-side.
- Right-click a cell to copy its full rendered value or create an equality,
  inequality, or null filter.
- Click a row number to open a searchable row-detail panel with full values,
  previous/next navigation, editing, and deletion.
- Inline cell editing and row deletion are enabled for plain single-table
  results with a primary key. Joins, aggregates, and tables without a primary
  key remain read-only.
- Common PostgreSQL types decode to JSON, including numeric scalars, UUID,
  JSON/JSONB, date/time types, bytea, enums, and one-dimensional arrays.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| **⌘K** | Open the command palette |
| **⌘T** | Open a new query tab |
| **⌘W** | Close the active query tab |
| **⌘↵** | Run selected SQL, or the full editor when nothing is selected |
| **⌘R** | Re-run the active query |
| **⌘F** | Open the searchable filter control for a table result |
| **⌘+** / **⌘-** / **⌘0** | Zoom in, zoom out, or reset zoom |

## Run it

Prereqs on macOS: **Rust** (`rustup`), **Node 18+**, and Xcode command line tools
(`xcode-select --install`).

```bash
npm install
npm run tauri dev        # first Rust build takes a few minutes
```

If `cargo` is not on the non-interactive shell path:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Useful development checks:

```bash
npx tsc --noEmit         # frontend typecheck
npm run build            # typecheck + production frontend bundle
cargo check --manifest-path src-tauri/Cargo.toml
```

Release build:

```bash
npm run tauri icon ./app-icon.png   # generate the full macOS icon set (.icns) once
npm run tauri build                 # produces src-tauri/target/release/bundle/macos/pgbolt.app
```

On an Apple Silicon Mac this produces an **arm64** build:

- `src-tauri/target/release/bundle/macos/pgbolt.app`
- `src-tauri/target/release/bundle/dmg/pgbolt_0.1.0_aarch64.dmg`

Drag `pgbolt.app` into `/Applications`. It runs with no warnings on the machine
you built it on (Tauri ad-hoc signs it locally).

## Installing on your other Mac (personal use)

This is unsigned / not notarized — fine for your own machines. To move the built
app to a second Mac (same arch, e.g. another Apple Silicon):

1. Build once (`npm run tauri build`) and copy `pgbolt.app` (or the `.dmg`) to the
   other Mac. **Prefer USB drive or `scp`** — AirDrop / iCloud / any download adds
   a quarantine flag that triggers *"unidentified developer."*
2. Drag `pgbolt.app` into `/Applications`.
3. If macOS blocks it (quarantined transfer), clear the flag once:

   ```bash
   xattr -cr /Applications/pgbolt.app
   ```

   …or, the first launch only, **right-click the app → Open → Open**. After that it
   opens normally forever.

No Apple Developer account, code signing, or notarization is needed for this. For
wider / non-technical distribution you would need a Developer ID certificate plus
notarization — out of scope here.

## Project layout

```
src/                     React UI
  App.tsx                connection/tab/query/filter state + global shortcuts
  api.ts                 typed Tauri invoke() wrappers
  types.ts               TypeScript mirrors of Rust response structs
  components/            editor, grid, sidebar, tabs, command palette, modals
src-tauri/src/
  db.rs                  pools, bounded queries, cancellation, introspection,
                         row updates/deletes
  convert.rs             PgRow -> serde_json::Value (the dynamic-type decoder)
  lib.rs                 command registration
```

## Known limitations (deliberate MVP cuts)

- **Passwords are stored in `localStorage` in plaintext.** Fine for local dev, not
  for real use. Swap to the OS keychain via `tauri-plugin-stronghold` or
  `keyring-rs` before you rely on it.
- Row-vs-command is decided by leading SQL keyword — good enough, but a mixed
  statement or a leading comment will fool it. A fuller version parses or uses
  `pool.describe()`.
- A `SELECT` returning **zero rows** shows no columns (columns are read off the
  first row here). Use `describe()` to get column metadata without data.
- Multi-statement scripts execute, but the UI does not present independent
  result tabs for each statement.
- The 5,000-row safety limit is currently fixed rather than configurable.
- No CSV export or horizontal column virtualization yet.
- Inline editing writes the new value as text, cast with `::<column type>` —
  this covers scalars, uuid/json/timestamp/numeric/bytea cleanly, but Postgres
  **array columns need array-literal syntax** (`{a,b}`, not `["a","b"]`) since
  that's what the grid displays.
- No optimistic-concurrency check beyond "0 rows affected" — two people
  editing the same row at once can silently clobber each other otherwise.
- Tabs and their query text are not persisted across app restarts.
- Applying a filter chip **rewrites the tab's SQL from scratch** (a plain
  `SELECT * FROM table WHERE …` skeleton) — fine for the sidebar/search-opened
  table-browsing flow, but hand-editing the query clears any filter chips
  first so a stale chip can never silently discard a hand-written query.
- Eagerly expanding every schema's tables on connect means a database with a
  huge number of schemas/tables will do a burst of `list_tables` calls up
  front — fine for typical app databases, not tuned for that scale.

## Natural next steps

1. Use `describe()` for reliable row/command classification and zero-row column
   metadata.
2. Move credentials from `localStorage` to the macOS Keychain.
3. Replace eager per-schema table loading with one bounded introspection query
   or lazy expansion.
4. Add query history and persist open tabs across restarts.
5. Add CSV export and horizontal column virtualization for very wide tables.
6. Add SSH tunneling for databases reached through a bastion.
