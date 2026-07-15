export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

export interface SavedConnection extends ConnectionConfig {
  id: string;
  name: string;
  favorite?: boolean;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
}

export interface QueryResult {
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  rows_affected: number;
  duration_ms: number;
  truncated: boolean;
}

export interface TableInfo {
  name: string;
  kind: string;
}

export interface TableRef {
  schema: string;
  name: string;
  kind: string;
}

export interface ColumnRef {
  schema: string;
  table: string;
  column: string;
}

/** schema name → table name → column names, for editor autocomplete. */
export type SchemaMap = Record<string, Record<string, string[]>>;

export interface ColumnValue {
  column: string;
  data_type: string;
  value: string | null;
}

export type FilterOp =
  | "="
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "like"
  | "is null"
  | "is not null";

export interface FilterCondition {
  column: string;
  op: FilterOp;
  value: string | null;
}

export interface QueryTab {
  id: string;
  connId: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  error: string | null;
  running: boolean;
  cancelling: boolean;
  queryId: string | null;
  tableRef: { schema: string; table: string } | null;
  /** null = not fetched yet, [] = no primary key (read-only) */
  pkColumns: string[] | null;
  filters: FilterCondition[];
}
