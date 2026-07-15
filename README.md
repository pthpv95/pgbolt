# pgbolt

A ligtning fast, native Postgres GUI for macOS — a TablePlus-shaped starting point built on
Tauri (Rust) + React/TypeScript. Rust owns the connection pools and query
execution; the webview is only the UI.


<img width="721" height="410" alt="image" src="https://github.com/user-attachments/assets/4537640a-010a-458e-8ab3-17807662c94b" />

## Why this stack

- **Tauri, not Electron** — no bundled Chromium, ~10 MB binary vs ~150 MB, and the
  hot path (connect, decode rows, stream to grid) runs in Rust, not JS. This is
  where "lightning fast" comes from.
- **sqlx** for async Postgres with a real connection pool per connection.
- **@tanstack/react-virtual** so a 100k-row result set renders only the visible
  rows — scrolling stays smooth regardless of result size.

## What works today

- Add / save connections (persisted locally), test on connect
- Schema + table tree in the sidebar (schemas expand by default), plus a
  search box to find a table by name across all schemas
- Multiple query tabs per connection — click a table to open it (or focus
  its existing tab) without losing other open tabs; `+` or **⌘T** for a
  blank query tab
- SQL editor (CodeMirror, Postgres syntax) with **⌘↵ to run** the selection (or
  the full editor when nothing is selected), plus a Stop button for cancelling
  an active PostgreSQL query
- Row-returning queries render in the virtualized grid; DML/DDL report rows-affected
- Ad-hoc results are capped at 5,000 rows with visible truncation feedback, so
  an accidental unbounded query cannot fill application memory
- Click a row number to open a row detail panel — full untruncated values,
  prev/next navigation, and (when editable) multi-line editing and delete
- Right-click a cell to filter the grid to matching (or non-matching) values;
  active filters show as removable chips above the grid
- Inline cell editing (double-click a cell) and row deletion, for any result
  whose source table has a primary key — the grid detects the table either
  because you opened it from the sidebar or because the SQL looks like a
  plain `SELECT … FROM schema.table …`. Tables without a primary key, or
  queries with joins/aggregation, stay read-only.
- **⌘+**/**⌘-**/**⌘0** to zoom the UI in/out/reset
- Per-query latency + row count readout
- Common Postgres types decoded to JSON (int/float/bool/text/uuid/json/jsonb/
  timestamp(tz)/date/time/numeric/bytea/text+int arrays), unknown types fall back
  to text

## Run it

Prereqs on macOS: **Rust** (`rustup`), **Node 18+**, and Xcode command line tools
(`xcode-select --install`).

```bash
npm install
npm run tauri dev        # first Rust build takes a few minutes
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
  api.ts                 typed invoke() wrappers
  components/            Sidebar, SqlEditor, ResultsGrid, ConnectionManager
src-tauri/src/
  db.rs                  connection registry + commands (connect/run_query/introspection)
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
- Grid columns are resizable and cells have a copy menu; no CSV export or
  horizontal column virtualization yet.
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

1. **Keychain-backed credentials.**
2. **SSH tunneling** (you already do this for RDS) — spawn the tunnel from Rust or
   integrate `russh` so connections can hop through a bastion.
3. Horizontal virtualization for very wide tables.
4. Query history, and persisting open tabs across restarts.
