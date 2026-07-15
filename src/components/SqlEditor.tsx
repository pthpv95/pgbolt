import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql, PostgreSQL } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import type { SchemaMap } from "../types";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onRun: (selectedSql: string | null) => void;
  disabled: boolean;
  schema?: SchemaMap;
  height?: number;
}

// High-contrast colors tuned for the app background. Keep identifiers close
// to the main foreground and use color to distinguish syntax, not to dim it.
const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#d8a7ff", fontWeight: "600" },
  { tag: [tags.name, tags.variableName, tags.propertyName, tags.typeName], color: "#f0f4f8" },
  { tag: tags.function(tags.variableName), color: "#82d2ff" },
  { tag: [tags.string, tags.character, tags.special(tags.string)], color: "#ffad8a" },
  { tag: tags.number, color: "#7ee2a8" },
  { tag: [tags.bool, tags.null, tags.atom], color: "#79c0ff" },
  { tag: [tags.operator, tags.operatorKeyword], color: "#ffd580" },
  { tag: [tags.punctuation, tags.bracket], color: "#c6d0dc" },
  { tag: tags.comment, color: "#94a3b8", fontStyle: "italic" },
  { tag: tags.invalid, color: "#ff7b72", textDecoration: "underline" },
]);
const sqlSyntaxHighlighting = syntaxHighlighting(sqlHighlightStyle);

// Minimal dark theme so CodeMirror matches the app shell.
const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "#f0f4f8",
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
      color: "#8491a3",
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
        run: (view) => {
          if (!disabled) {
            const { from, to } = view.state.selection.main;
            const selectedSql = from === to ? "" : view.state.sliceDoc(from, to).trim();
            onRun(selectedSql || null);
          }
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
      extensions={[sqlExt, sqlSyntaxHighlighting, runKey]}
      onChange={onChange}
      basicSetup={{ foldGutter: false, highlightActiveLineGutter: true, syntaxHighlighting: false }}
    />
  );
}
