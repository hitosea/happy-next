import codemirrorBundleSource from './codemirror-bundle-string';

export type EditorCommand =
    | { type: 'setValue'; value: string }
    | { type: 'setLanguage'; language: string }
    | { type: 'setTheme'; theme: 'light' | 'dark' }
    | { type: 'setBottomPadding'; bottomPadding: number }
    | { type: 'setReadOnly'; readOnly: boolean }
    | { type: 'revealPosition'; line: number; column?: number }
    | { type: 'focus' }
    | { type: 'blur' };

export type EditorEvent =
    | { type: 'ready'; value: string }
    | { type: 'change'; value: string }
    | { type: 'error'; message: string };

export function encodeBase64Utf8(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function buildEditorHtml(args: {
    initialValueBase64: string;
    initialLanguage: string;
    initialTheme: 'light' | 'dark';
    initialBottomPadding: number;
    initialReadOnly: boolean;
}): string {
    const {
        initialValueBase64,
        initialLanguage,
        initialTheme,
        initialBottomPadding,
        initialReadOnly,
    } = args;
    const safeLanguage = JSON.stringify(initialLanguage);
    const safeTheme = JSON.stringify(initialTheme);
    const safeBottomPadding = Number.isFinite(initialBottomPadding) ? initialBottomPadding : 16;

    return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body, #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: transparent;
      }
      #root {
        position: relative;
      }
      #fallback {
        display: none;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border: 0;
        outline: none;
        resize: none;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 14px;
        line-height: 20px;
        padding: 12px 12px ${safeBottomPadding}px;
        white-space: pre;
        overflow: auto;
      }
      .cm-editor {
        height: 100%;
      }
      .cm-editor .cm-scroller {
        overflow: auto;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 14px;
        line-height: 20px;
      }
      .happy-target-line-dark {
        background: #ff8a0038;
        border-left: 3px solid #ff9f1a;
      }
      .happy-target-line-light {
        background: #ff6a0026;
        border-left: 3px solid #d9480f;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <textarea id="fallback" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off"></textarea>
    <script>${codemirrorBundleSource}</script>
    <script>
      (function () {
        var initialValueBase64 = ${JSON.stringify(initialValueBase64)};
        var initialLanguage = ${safeLanguage};
        var initialTheme = ${safeTheme};
        var initialBottomPadding = ${safeBottomPadding};
        var initialReadOnly = ${initialReadOnly ? 'true' : 'false'};

        var view = null;
        var fallback = document.getElementById('fallback');
        var root = document.getElementById('root');
        var suppressChanges = false;

        // Compartments for dynamic reconfiguration
        var languageCompartment = null;
        var themeCompartment = null;
        var readOnlyCompartment = null;
        var bottomPaddingCompartment = null;

        // Target line highlight state
        var targetLineEffect = null;
        var clearTargetLineEffect = null;

        function decodeBase64Utf8(str) {
          var binary = atob(str);
          var bytes = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          return new TextDecoder('utf-8').decode(bytes);
        }

        function post(event) {
          var data = JSON.stringify(event);
          if (window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
            window.ReactNativeWebView.postMessage(data);
            return;
          }
          if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(data, '*');
          }
        }

        function setFallbackTheme(theme) {
          var dark = theme === 'dark';
          fallback.style.background = dark ? '#14161a' : '#ffffff';
          fallback.style.color = dark ? '#d4d4d4' : '#1f2328';
          fallback.style.caretColor = dark ? '#d4d4d4' : '#1f2328';
        }

        function mountFallback(initialValue) {
          root.style.display = 'none';
          fallback.style.display = 'block';
          fallback.value = initialValue;
          fallback.readOnly = !!initialReadOnly;
          setFallbackTheme(initialTheme);
          fallback.addEventListener('input', function () {
            post({ type: 'change', value: fallback.value });
          });
          post({ type: 'ready', value: fallback.value });
        }

        function clampNumber(value, min, max) {
          return Math.min(max, Math.max(min, value));
        }

        function getLanguageExtension(lang) {
          if (!window.CM) return [];
          var langs = window.CM.langs;
          var language = window.CM.language;
          var l = (lang || '').toLowerCase();
          switch (l) {
            case 'javascript':
            case 'jsx':
              return [langs.javascript({ jsx: true })];
            case 'typescript':
            case 'tsx':
              return [langs.javascript({ jsx: true, typescript: true })];
            case 'python':
              return [langs.python()];
            case 'html':
            case 'htm':
              return [langs.html()];
            case 'css':
              return [langs.css()];
            case 'json':
              return [langs.json()];
            case 'markdown':
            case 'md':
              return [langs.markdown()];
            case 'xml':
              return [langs.xml()];
            case 'yaml':
            case 'yml':
              return [langs.yaml()];
            case 'sql':
              return [langs.sql()];
            case 'shell':
            case 'bash':
            case 'sh':
              return [language.StreamLanguage.define(langs.shell)];
            default:
              return [];
          }
        }

        function buildThemeExtension(theme) {
          var CM = window.CM;
          if (!CM) return [];
          var isDark = theme === 'dark';
          var syntaxStyle = isDark
            ? CM.language.syntaxHighlighting(CM.language.oneDarkHighlightStyle)
            : CM.language.syntaxHighlighting(CM.language.defaultHighlightStyle);

          var editorTheme = CM.view.EditorView.theme({
            '&': {
              backgroundColor: isDark ? '#14161a' : '#ffffff',
              color: isDark ? '#d4d4d4' : '#1f2328',
            },
            '.cm-cursor, .cm-dropCursor': {
              borderLeftColor: isDark ? '#d4d4d4' : '#1f2328',
            },
            '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
              backgroundColor: isDark ? '#264f78' : '#add6ff',
            },
            '.cm-gutters': {
              backgroundColor: isDark ? '#14161a' : '#ffffff',
              borderRight: 'none',
            },
            '.cm-lineNumbers .cm-gutterElement': {
              color: isDark ? '#6b7280' : '#9ca3af',
            },
            '.cm-activeLineGutter .cm-gutterElement, .cm-gutterElement.cm-activeLineGutter': {
              color: isDark ? '#9ca3af' : '#4b5563',
            },
          }, { dark: isDark });

          return [editorTheme, syntaxStyle];
        }

        function buildBottomPaddingExtension(padding) {
          var CM = window.CM;
          if (!CM) return [];
          return CM.view.EditorView.contentAttributes.of({
            style: 'padding-bottom: ' + Math.max(0, padding || 0) + 'px; padding-top: 12px;'
          });
        }

        function tryMountCM(initialValue) {
          if (!window.CM) {
            post({ type: 'error', message: 'CodeMirror unavailable, fallback to plain editor' });
            mountFallback(initialValue);
            return;
          }

          try {
            var CM = window.CM;

            languageCompartment = new CM.state.Compartment();
            themeCompartment = new CM.state.Compartment();
            readOnlyCompartment = new CM.state.Compartment();
            bottomPaddingCompartment = new CM.state.Compartment();

            // Target line highlight via StateEffect + StateField + Decoration
            targetLineEffect = CM.state.StateEffect.define();
            clearTargetLineEffect = CM.state.StateEffect.define();

            var targetLineField = CM.state.StateField.define({
              create: function () { return CM.view.Decoration.none; },
              update: function (decos, tr) {
                decos = decos.map(tr.changes);
                for (var i = 0; i < tr.effects.length; i++) {
                  var e = tr.effects[i];
                  if (e.is(clearTargetLineEffect)) {
                    decos = CM.view.Decoration.none;
                  } else if (e.is(targetLineEffect)) {
                    var line = tr.state.doc.line(e.value.line);
                    var cls = e.value.theme === 'dark' ? 'happy-target-line-dark' : 'happy-target-line-light';
                    decos = CM.view.Decoration.set([
                      CM.view.Decoration.line({ class: cls }).range(line.from)
                    ]);
                  }
                }
                return decos;
              },
              provide: function (field) {
                return CM.view.EditorView.decorations.from(field);
              }
            });

            var updateListener = CM.view.EditorView.updateListener.of(function (update) {
              if (update.docChanged && !suppressChanges) {
                post({ type: 'change', value: update.state.doc.toString() });
              }
            });

            var state = CM.state.EditorState.create({
              doc: initialValue,
              extensions: [
                CM.view.lineNumbers(),
                CM.view.highlightActiveLineGutter(),
                CM.view.drawSelection(),
                CM.commands.history(),
                languageCompartment.of(getLanguageExtension(initialLanguage)),
                themeCompartment.of(buildThemeExtension(initialTheme)),
                readOnlyCompartment.of(CM.state.EditorState.readOnly.of(!!initialReadOnly)),
                bottomPaddingCompartment.of(buildBottomPaddingExtension(initialBottomPadding)),
                targetLineField,
                CM.search.highlightSelectionMatches(),
                CM.view.keymap.of([].concat(
                  CM.commands.defaultKeymap,
                  CM.commands.historyKeymap,
                  CM.search.searchKeymap
                )),
                updateListener,
              ],
            });

            view = new CM.view.EditorView({
              state: state,
              parent: root,
            });

            post({ type: 'ready', value: view.state.doc.toString() });
          } catch (err) {
            post({ type: 'error', message: 'CodeMirror mount failed: ' + String(err) });
            mountFallback(initialValue);
          }
        }

        function revealPosition(line, column) {
          var targetLine = Math.max(1, Math.floor(Number(line) || 1));
          var targetColumn = Math.max(1, Math.floor(Number(column) || 1));

          if (view) {
            var doc = view.state.doc;
            var lineCount = doc.lines;
            targetLine = clampNumber(targetLine, 1, lineCount);
            var lineObj = doc.line(targetLine);
            var maxColumn = lineObj.length + 1;
            targetColumn = clampNumber(targetColumn, 1, maxColumn);
            var pos = lineObj.from + targetColumn - 1;

            view.dispatch({
              selection: { anchor: pos },
              effects: [
                CM.view.EditorView.scrollIntoView(pos, { y: 'center' }),
                targetLineEffect.of({ line: targetLine, theme: initialTheme }),
              ],
            });
            return;
          }

          // Fallback textarea positioning
          var text = fallback.value || '';
          var lines = text.split('\\n');
          targetLine = clampNumber(targetLine, 1, Math.max(1, lines.length));
          var lineText = lines[targetLine - 1] || '';
          targetColumn = clampNumber(targetColumn, 1, Math.max(1, lineText.length + 1));

          var offset = 0;
          for (var i = 0; i < targetLine - 1; i++) {
            offset += (lines[i] || '').length + 1;
          }
          offset += targetColumn - 1;
          offset = clampNumber(offset, 0, text.length);

          var computedStyle = window.getComputedStyle(fallback);
          var lineHeight = parseFloat(computedStyle.lineHeight || '20') || 20;
          var targetTop = Math.max(0, (targetLine - 1) * lineHeight - fallback.clientHeight / 2 + lineHeight / 2);
          fallback.scrollTop = targetTop;
          fallback.setSelectionRange(offset, offset);
        }

        function applyCommand(command) {
          if (command.type === 'setTheme') {
            initialTheme = command.theme;
            if (view && window.CM) {
              view.dispatch({
                effects: themeCompartment.reconfigure(buildThemeExtension(command.theme)),
              });
            } else {
              setFallbackTheme(command.theme);
            }
            return;
          }

          if (command.type === 'setBottomPadding') {
            var padding = Math.max(0, command.bottomPadding || 0);
            if (view && window.CM) {
              view.dispatch({
                effects: bottomPaddingCompartment.reconfigure(buildBottomPaddingExtension(padding)),
              });
            } else {
              fallback.style.paddingBottom = padding + 'px';
            }
            return;
          }

          if (command.type === 'setReadOnly') {
            initialReadOnly = !!command.readOnly;
            if (view && window.CM) {
              view.dispatch({
                effects: readOnlyCompartment.reconfigure(
                  window.CM.state.EditorState.readOnly.of(initialReadOnly)
                ),
              });
            } else {
              fallback.readOnly = initialReadOnly;
            }
            return;
          }

          if (command.type === 'setValue') {
            if (view) {
              var current = view.state.doc.toString();
              if (current !== command.value) {
                suppressChanges = true;
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: command.value },
                });
                suppressChanges = false;
              }
            } else if (fallback.value !== command.value) {
              fallback.value = command.value;
            }
            return;
          }

          if (command.type === 'setLanguage') {
            if (view && window.CM) {
              view.dispatch({
                effects: languageCompartment.reconfigure(getLanguageExtension(command.language)),
              });
            }
            return;
          }

          if (command.type === 'revealPosition') {
            revealPosition(command.line, command.column);
            return;
          }

          if (command.type === 'focus') {
            if (view) view.focus();
            else fallback.focus();
            return;
          }

          if (command.type === 'blur') {
            if (view && document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            } else {
              fallback.blur();
            }
          }
        }

        function attachCommandBridge() {
          function handleMessage(event) {
            if (!event || typeof event.data !== 'string') return;
            try {
              var command = JSON.parse(event.data);
              applyCommand(command);
            } catch (error) {
              post({ type: 'error', message: String(error) });
            }
          }
          window.addEventListener('message', handleMessage);
          document.addEventListener('message', handleMessage);
        }

        try {
          attachCommandBridge();
          var initialValue = decodeBase64Utf8(initialValueBase64);
          tryMountCM(initialValue);
        } catch (error) {
          post({ type: 'error', message: String(error) });
          mountFallback('');
        }
      })();
    </script>
  </body>
</html>`;
}
