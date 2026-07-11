//! Converts a dynamically-typed `PgRow` into `serde_json::Value` so arbitrary
//! query results can cross the Tauri boundary. This is the part most Rust DB
//! tools get wrong: sqlx needs a concrete Rust type to decode a column, so we
//! branch on the Postgres type name and fall back to text for anything exotic.

use serde_json::{json, Value};
use sqlx::postgres::{PgColumn, PgRow};
use sqlx::{Column, Row, TypeInfo};

pub fn row_to_json(row: &PgRow) -> Value {
    let mut map = serde_json::Map::with_capacity(row.columns().len());
    for col in row.columns() {
        map.insert(col.name().to_string(), column_to_json(row, col));
    }
    Value::Object(map)
}

fn column_to_json(row: &PgRow, col: &PgColumn) -> Value {
    let i = col.ordinal();
    let type_name = col.type_info().name();

    // Try to decode as `Option<T>`; NULL -> Value::Null, decode error -> Null.
    macro_rules! get {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => json!(v),
                Ok(None) => Value::Null,
                Err(_) => Value::Null,
            }
        };
    }
    // Same, but stringify the decoded value (for types JSON has no native form for).
    macro_rules! get_str {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => json!(v.to_string()),
                _ => Value::Null,
            }
        };
    }

    match type_name {
        "BOOL" => get!(bool),
        "INT2" => get!(i16),
        "INT4" => get!(i32),
        "INT8" => get!(i64),
        "FLOAT4" => get!(f32),
        "FLOAT8" => get!(f64),
        "TEXT" | "VARCHAR" | "BPCHAR" | "CHAR" | "NAME" | "CITEXT" | "\"char\"" => get!(String),
        "NUMERIC" => get_str!(sqlx::types::BigDecimal),
        "UUID" => get_str!(sqlx::types::Uuid),
        "JSON" | "JSONB" => get!(serde_json::Value),
        "TIMESTAMPTZ" => match row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(i) {
            Ok(Some(v)) => json!(v.to_rfc3339()),
            _ => Value::Null,
        },
        "TIMESTAMP" => get_str!(chrono::NaiveDateTime),
        "DATE" => get_str!(chrono::NaiveDate),
        "TIME" => get_str!(chrono::NaiveTime),
        "BYTEA" => match row.try_get::<Option<Vec<u8>>, _>(i) {
            Ok(Some(v)) => json!(format!("\\x{}", hex::encode(v))),
            _ => Value::Null,
        },
        // Arrays and other rich types: try common array shapes, else show the type tag.
        "_TEXT" | "_VARCHAR" => get!(Vec<String>),
        "_INT4" => get!(Vec<i32>),
        "_INT8" => get!(Vec<i64>),
        _ => match row.try_get::<Option<String>, _>(i) {
            Ok(Some(v)) => json!(v),
            _ => Value::String(format!("<{type_name}>")),
        },
    }
}
