import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { SchemaMap } from "../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: () => void;
  disabled: boolean;
  schema?: SchemaMap;
  height?: number;
}

// Minimal dark theme so CodeMirror matches the app shell.
const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#e4e9f0",
      // The app shell disables selection globally. Override it at the editor
      // boundary so WebKit allows normal click-drag selection for copying.
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-scroller, .cm-content": {
      userSelect: "text",
      WebkitUserSelect: "text",
    },
    ".cm-content": { caretColor: "#3b9dff" },
    ".cm-gutters": {
      backgroundColor: "#12161c",
      color: "#5a6472",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "#151a2140" },
    ".cm-activeLineGutter": { backgroundColor: "#151a21" },
    "&.cm-focused": { outline: "none" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "#2d78b899" },
  },
  { dark: true }
);

export function SqlEditor({ value, onChange, onRun, disabled, schema, height = 150 }: Props) {
  const runKey = Prec.highest(
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          if (!disabled) onRun();
          return true;
        },
      },
    ])
  );

  // Rebuild the SQL support only when the schema map changes (per connection),
  // not on every keystroke — the parser/completion setup isn't free.
  const sqlExt = useMemo(
    () =>
      sql({
        dialect: PostgreSQL,
        schema,
        // Tables in `public` (and their columns) complete without a prefix.
        defaultSchema: "public",
        upperCaseKeywords: true,
      }),
    [schema]
  );

  return (
    <CodeMirror
      value={value}
      height={`${height}px`}
      theme={theme}
      extensions={[sqlExt, runKey]}
      onChange={onChange}
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true }}
    />
  );
}
