export function renderValue(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: "NULL", isNull: true };
  if (typeof v === "object") return { text: JSON.stringify(v), isNull: false };
  return { text: String(v), isNull: false };
}
