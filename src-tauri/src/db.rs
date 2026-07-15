//! Connection registry + the Tauri commands the frontend calls.
//!
//! Each named connection owns a small `PgPool`. Pools are cheap to clone and
//! are `Send + Sync`, so commands grab a clone under a short read lock and then
//! run their query without holding the lock.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions, PgSslMode};
use sqlx::{Column, Row, TypeInfo};
use tauri::State;
use tokio::sync::RwLock;

use crate::convert::row_to_json;

#[derive(Default)]
pub struct AppState {
    connections: RwLock<HashMap<String, PgPool>>,
}

#[derive(Deserialize)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub ssl: bool,
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize)]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<serde_json::Value>,
    pub rows_affected: u64,
    pub duration_ms: u128,
}

#[derive(Serialize)]
pub struct TableInfo {
    pub name: String,
    pub kind: String, // "BASE TABLE" | "VIEW" | ...
}

#[derive(Serialize)]
pub struct TableRef {
    pub schema: String,
    pub name: String,
    pub kind: String,
}

#[derive(Serialize)]
pub struct ColumnRef {
    pub schema: String,
    pub table: String,
    pub column: String,
}

/// A single column's name, its Postgres type (used to cast the bound text
/// value back to the right type), and its new/lookup value. `value: None`
/// means SQL NULL.
#[derive(Deserialize)]
pub struct ColumnValue {
    pub column: String,
    pub data_type: String,
    pub value: Option<String>,
}

/// Wrap an identifier in double quotes, escaping embedded quotes. Postgres
/// has no parameter binding for identifiers, so this is the safe way to
/// splice a schema/table/column name into SQL text.
fn quote_ident(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

/// Turn a `ColumnInfo.data_type` (e.g. `INT4`, `_TEXT`, `"char"`) into a
/// valid cast target (`int4`, `text[]`), rejecting anything that isn't a
/// plain identifier so it's safe to splice into `$n::<cast>`.
fn cast_type(data_type: &str) -> Result<String, String> {
    let (base, is_array) = match data_type.strip_prefix('_') {
        Some(rest) => (rest, true),
        None => (data_type, false),
    };
    let base = base.to_ascii_lowercase();
    let valid = base
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && base.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(format!("unsupported type for edit: {data_type}"));
    }
    Ok(if is_array { format!("{base}[]") } else { base })
}

/// Postgres's extended query protocol only permits one command per prepared
/// statement. Keep that fast path for normal queries, but recognize the
/// server error so editor scripts can be retried through the simple protocol.
fn is_multiple_statements_error(error: &sqlx::Error) -> bool {
    matches!(
        error,
        sqlx::Error::Database(database_error)
            if database_error
                .message()
                .contains("cannot insert multiple commands into a prepared statement")
    )
}

async fn pool_for(state: &State<'_, AppState>, conn_id: &str) -> Result<PgPool, String> {
    state
        .connections
        .read()
        .await
        .get(conn_id)
        .cloned()
        .ok_or_else(|| format!("No active connection: {conn_id}"))
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    conn_id: String,
    config: ConnectionConfig,
) -> Result<String, String> {
    let opts = PgConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.user)
        .password(&config.password)
        .database(&config.database)
        .ssl_mode(if config.ssl {
            PgSslMode::Require
        } else {
            PgSslMode::Prefer
        });

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_with(opts)
        .await
        .map_err(|e| e.to_string())?;

    // Fail fast if the credentials/host are wrong.
    sqlx::query("SELECT 1")
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    state.connections.write().await.insert(conn_id.clone(), pool);
    Ok(conn_id)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, conn_id: String) -> Result<(), String> {
    if let Some(pool) = state.connections.write().await.remove(&conn_id) {
        pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn run_query(
    state: State<'_, AppState>,
    conn_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let start = Instant::now();

    // Decide row-returning vs. command by leading keyword. Good enough for an
    // MVP editor; a fuller version would parse or use describe().
    let head = sql.trim_start().to_ascii_lowercase();
    let returns_rows = ["select", "with", "show", "explain", "values", "table"]
        .iter()
        .any(|k| head.starts_with(k));

    if returns_rows {
        let rows = match sqlx::query(&sql).fetch_all(&pool).await {
            Ok(rows) => rows,
            Err(error) if is_multiple_statements_error(&error) => sqlx::raw_sql(&sql)
                .fetch_all(&pool)
                .await
                .map_err(|e| e.to_string())?,
            Err(error) => return Err(error.to_string()),
        };

        let columns = rows
            .first()
            .map(|r| {
                r.columns()
                    .iter()
                    .map(|c| ColumnInfo {
                        name: c.name().to_string(),
                        data_type: c.type_info().name().to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(QueryResult {
            columns,
            rows: rows.iter().map(row_to_json).collect(),
            rows_affected: 0,
            duration_ms: start.elapsed().as_millis(),
        })
    } else {
        let res = match sqlx::query(&sql).execute(&pool).await {
            Ok(result) => result,
            Err(error) if is_multiple_statements_error(&error) => sqlx::raw_sql(&sql)
                .execute(&pool)
                .await
                .map_err(|e| e.to_string())?,
            Err(error) => return Err(error.to_string()),
        };
        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: res.rows_affected(),
            duration_ms: start.elapsed().as_millis(),
        })
    }
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<String>, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let rows = sqlx::query(
        "SELECT schema_name FROM information_schema.schemata \
         WHERE schema_name NOT LIKE 'pg_%' AND schema_name <> 'information_schema' \
         ORDER BY 1",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<TableInfo>, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let rows = sqlx::query(
        "SELECT table_name, table_type FROM information_schema.tables \
         WHERE table_schema = $1 ORDER BY table_type DESC, table_name",
    )
    .bind(&schema)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| TableInfo {
            name: r.get::<String, _>(0),
            kind: r.get::<String, _>(1),
        })
        .collect())
}

#[tauri::command]
pub async fn search_tables(
    state: State<'_, AppState>,
    conn_id: String,
    query: String,
) -> Result<Vec<TableRef>, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let rows = sqlx::query(
        "SELECT table_schema, table_name, table_type FROM information_schema.tables \
         WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema' \
         AND table_name ILIKE '%' || $1 || '%' \
         ORDER BY table_schema, table_name LIMIT 100",
    )
    .bind(&query)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| TableRef {
            schema: r.get::<String, _>(0),
            name: r.get::<String, _>(1),
            kind: r.get::<String, _>(2),
        })
        .collect())
}

/// Every user-schema column in one round trip — used to seed SQL editor
/// autocomplete. Kept to a single indexed scan of `information_schema.columns`
/// so it stays cheap even on large databases.
#[tauri::command]
pub async fn list_columns(
    state: State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ColumnRef>, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let rows = sqlx::query(
        "SELECT table_schema, table_name, column_name FROM information_schema.columns \
         WHERE table_schema NOT LIKE 'pg_%' AND table_schema <> 'information_schema' \
         ORDER BY table_schema, table_name, ordinal_position",
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| ColumnRef {
            schema: r.get::<String, _>(0),
            table: r.get::<String, _>(1),
            column: r.get::<String, _>(2),
        })
        .collect())
}

#[tauri::command]
pub async fn primary_keys(
    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<Vec<String>, String> {
    let pool = pool_for(&state, &conn_id).await?;
    let rows = sqlx::query(
        "SELECT kcu.column_name \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 \
         ORDER BY kcu.ordinal_position",
    )
    .bind(&schema)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
}

/// Build `col = $n::cast, col2 = $n+1::cast, …`, appending each bound value
/// to `values` and advancing `idx`. Shared between `update_row`'s SET/WHERE
/// clauses and `delete_row`'s WHERE clause.
fn append_assignments(
    sql: &mut String,
    cols: &[ColumnValue],
    sep: &str,
    idx: &mut usize,
    values: &mut Vec<Option<String>>,
) -> Result<(), String> {
    for (i, cv) in cols.iter().enumerate() {
        if i > 0 {
            sql.push_str(sep);
        }
        let cast = cast_type(&cv.data_type)?;
        sql.push_str(&format!("{} = ${}::{}", quote_ident(&cv.column), idx, cast));
        values.push(cv.value.clone());
        *idx += 1;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_row(
    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
    set: Vec<ColumnValue>,
    pk: Vec<ColumnValue>,
) -> Result<u64, String> {
    if set.is_empty() || pk.is_empty() {
        return Err("update_row requires at least one SET column and one PK column".into());
    }
    let pool = pool_for(&state, &conn_id).await?;

    let mut sql = format!(
        "UPDATE {}.{} SET ",
        quote_ident(&schema),
        quote_ident(&table)
    );
    let mut idx = 1;
    let mut values = Vec::with_capacity(set.len() + pk.len());
    append_assignments(&mut sql, &set, ", ", &mut idx, &mut values)?;
    sql.push_str(" WHERE ");
    append_assignments(&mut sql, &pk, " AND ", &mut idx, &mut values)?;

    let mut q = sqlx::query(&sql);
    for v in values {
        q = q.bind(v);
    }
    let res = q.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(res.rows_affected())
}

#[tauri::command]
pub async fn delete_row(
    state: State<'_, AppState>,
    conn_id: String,
    schema: String,
    table: String,
    pk: Vec<ColumnValue>,
) -> Result<u64, String> {
    if pk.is_empty() {
        return Err("delete_row requires at least one PK column".into());
    }
    let pool = pool_for(&state, &conn_id).await?;

    let mut sql = format!(
        "DELETE FROM {}.{} WHERE ",
        quote_ident(&schema),
        quote_ident(&table)
    );
    let mut idx = 1;
    let mut values = Vec::with_capacity(pk.len());
    append_assignments(&mut sql, &pk, " AND ", &mut idx, &mut values)?;

    let mut q = sqlx::query(&sql);
    for v in values {
        q = q.bind(v);
    }
    let res = q.execute(&pool).await.map_err(|e| e.to_string())?;
    Ok(res.rows_affected())
}
