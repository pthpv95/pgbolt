//! Converts a dynamically-typed `PgRow` into `serde_json::Value` so arbitrary
//! query results can cross the Tauri boundary. This is the part most Rust DB
//! tools get wrong: sqlx needs a concrete Rust type to decode a column, so we
//! branch on the Postgres type name and fall back to text for anything exotic.

use serde_json::{json, Value};
use sqlx::postgres::{PgColumn, PgRow, PgTypeKind};
use sqlx::{Column, Row, TypeInfo, ValueRef};

pub fn row_to_json(row: &PgRow) -> Value {
    let mut map = serde_json::Map::with_capacity(row.columns().len());
    for col in row.columns() {
        map.insert(col.name().to_string(), column_to_json(row, col));
    }
    Value::Object(map)
}

/// Postgres's binary wire format for an enum value is just the label's UTF-8
/// bytes (see `enum_send` server-side), so it can be read as text directly —
/// sqlx's `Decode<String>` refuses to touch a non-builtin type OID, which is
/// why this can't just be `get!(String)`.
fn enum_label(row: &PgRow, i: usize) -> Value {
    match row.try_get_raw(i) {
        Ok(raw) if !raw.is_null() => match raw.as_str() {
            Ok(s) => json!(s),
            Err(_) => Value::Null,
        },
        _ => Value::Null,
    }
}

/// Same trick, applied element-by-element: for an array of enums (sqlx has
/// no built-in decoder for those), hand-parse Postgres's binary array wire
/// format — ndim/flags/elem-oid header, one (size, lower bound) pair per
/// dimension, then length-prefixed elements — and read each element as
/// UTF-8 text. Bails out (`None`) on anything multi-dimensional so the
/// caller can fall back to the type tag.
fn text_array(raw: &[u8]) -> Option<Vec<Value>> {
    let ndim = i32::from_be_bytes(raw.get(0..4)?.try_into().ok()?);
    if ndim == 0 {
        return Some(vec![]);
    }
    if ndim != 1 {
        return None;
    }
    let dim_len = i32::from_be_bytes(raw.get(12..16)?.try_into().ok()?);
    let mut pos = 20usize; // 12-byte header + one (size, lower bound) pair
    let mut out = Vec::with_capacity(dim_len.max(0) as usize);
    for _ in 0..dim_len {
        let len = i32::from_be_bytes(raw.get(pos..pos + 4)?.try_into().ok()?);
        pos += 4;
        if len == -1 {
            out.push(Value::Null);
            continue;
        }
        let len = len as usize;
        let bytes = raw.get(pos..pos + len)?;
        out.push(json!(std::str::from_utf8(bytes).ok()?));
        pos += len;
    }
    Some(out)
}

fn column_to_json(row: &PgRow, col: &PgColumn) -> Value {
    let i = col.ordinal();
    let type_info = col.type_info();
    let type_name = type_info.name();

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
    // Array elements decode into `Option<T>` (not bare `T`) since individual
    // elements can be SQL NULL (e.g. `ARRAY['a', NULL, 'b']`) independently
    // of the array itself being NULL.
    macro_rules! get_vec {
        ($ty:ty) => {
            match row.try_get::<Option<Vec<Option<$ty>>>, _>(i) {
                Ok(Some(v)) => Value::Array(
                    v.into_iter()
                        .map(|x| x.map(|x| json!(x)).unwrap_or(Value::Null))
                        .collect(),
                ),
                Ok(None) => Value::Null,
                Err(_) => Value::Null,
            }
        };
    }
    // Same, but stringify each element (for types JSON has no native form for).
    macro_rules! get_str_vec {
        ($ty:ty) => {
            match row.try_get::<Option<Vec<Option<$ty>>>, _>(i) {
                Ok(Some(v)) => Value::Array(
                    v.into_iter()
                        .map(|x| x.map(|x| json!(x.to_string())).unwrap_or(Value::Null))
                        .collect(),
                ),
                Ok(None) => Value::Null,
                Err(_) => Value::Null,
            }
        };
    }

    // `TypeInfo::name()` renders array types as e.g. "TEXT[]", not the
    // "_text" catalog name, so array-ness is checked via `kind()` and
    // dispatched on the *element*'s name instead of string-matching that.
    if let PgTypeKind::Array(elem) = type_info.kind() {
        return match elem.name() {
            "BOOL" => get_vec!(bool),
            "INT2" => get_vec!(i16),
            "INT4" => get_vec!(i32),
            "INT8" => get_vec!(i64),
            "FLOAT4" => get_vec!(f32),
            "FLOAT8" => get_vec!(f64),
            "TEXT" | "VARCHAR" | "CHAR" | "\"CHAR\"" | "NAME" => get_vec!(String),
            "NUMERIC" => get_str_vec!(sqlx::types::BigDecimal),
            "UUID" => get_str_vec!(sqlx::types::Uuid),
            "DATE" => get_str_vec!(chrono::NaiveDate),
            "TIME" => get_str_vec!(chrono::NaiveTime),
            "TIMESTAMP" => get_str_vec!(chrono::NaiveDateTime),
            "TIMESTAMPTZ" => {
                match row.try_get::<Option<Vec<Option<chrono::DateTime<chrono::Utc>>>>, _>(i) {
                    Ok(Some(v)) => Value::Array(
                        v.into_iter()
                            .map(|d| d.map(|d| json!(d.to_rfc3339())).unwrap_or(Value::Null))
                            .collect(),
                    ),
                    _ => Value::Null,
                }
            }
            "JSON" | "JSONB" => get_vec!(serde_json::Value),
            // Arrays of enums (or anything else sqlx can't decode): fall back
            // to a hand-rolled binary parse for enums, else the type tag.
            _ => {
                if matches!(elem.kind(), PgTypeKind::Enum(_)) {
                    if let Ok(raw) = row.try_get_raw(i) {
                        if raw.is_null() {
                            return Value::Null;
                        }
                        if let Ok(bytes) = raw.as_bytes() {
                            if let Some(items) = text_array(bytes) {
                                return Value::Array(items);
                            }
                        }
                    }
                }
                Value::String(format!("<{type_name}>"))
            }
        };
    }

    if matches!(type_info.kind(), PgTypeKind::Enum(_)) {
        return enum_label(row, i);
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
        _ => match row.try_get::<Option<String>, _>(i) {
            Ok(Some(v)) => json!(v),
            _ => Value::String(format!("<{type_name}>")),
        },
    }
}
