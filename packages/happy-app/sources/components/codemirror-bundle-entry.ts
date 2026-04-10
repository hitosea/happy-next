import { EditorState, StateField, StateEffect, Compartment } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  type DecorationSet,
} from '@codemirror/view';
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  StreamLanguage,
} from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

(window as any).CM = {
  state: { EditorState, StateField, StateEffect, Compartment },
  view: {
    EditorView,
    Decoration,
    keymap,
    lineNumbers,
    drawSelection,
    highlightActiveLine,
    highlightActiveLineGutter,
  },
  language: { syntaxHighlighting, defaultHighlightStyle, StreamLanguage, oneDarkHighlightStyle },
  commands: { defaultKeymap, history, historyKeymap },
  search: { searchKeymap, highlightSelectionMatches },
  langs: { javascript, python, html, css, json, markdown, xml, yaml, sql, shell },
};
