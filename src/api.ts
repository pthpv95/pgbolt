import { invoke } from "@tauri-apps/api/core";
import type { ColumnRef, ColumnValue, ConnectionConfig, QueryResult, TableInfo, TableRef } from "./types";

export const api = {
  connect(connId: string, config: ConnectionConfig) {
    return invoke<string>("connect", { connId, config });
  },
  disconnect(connId: string) {
    return invoke<void>("disconnect", { connId });
  },
  runQuery(connId: string, sql: string, queryId: string) {
    return invoke<QueryResult>("run_query", { connId, sql, queryId });
  },
  cancelQuery(connId: string, queryId: string) {
    return invoke<boolean>("cancel_query", { connId, queryId });
  },
  listSchemas(connId: string) {
    return invoke<string[]>("list_schemas", { connId });
  },
  listTables(connId: string, schema: string) {
    return invoke<TableInfo[]>("list_tables", { connId, schema });
  },
  searchTables(connId: string, query: string) {
    return invoke<TableRef[]>("search_tables", { connId, query });
  },
  listColumns(connId: string) {
    return invoke<ColumnRef[]>("list_columns", { connId });
  },
  primaryKeys(connId: string, schema: string, table: string) {
    return invoke<string[]>("primary_keys", { connId, schema, table });
  },
  updateRow(connId: string, schema: string, table: string, set: ColumnValue[], pk: ColumnValue[]) {
    return invoke<number>("update_row", { connId, schema, table, set, pk });
  },
  deleteRow(connId: string, schema: string, table: string, pk: ColumnValue[]) {
    return invoke<number>("delete_row", { connId, schema, table, pk });
  },
};
