import * as React from 'react';
import { Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useUnistyles } from 'react-native-unistyles';
import { highlightTextToHtml } from '@/utils/highlightTextToHtml';
import { MONO_FONT_STACK } from '@/components/codeEditorConstants';

/**
 * Selectable, syntax-highlighted text rendering shared by the text-selection
 * screen and inline surfaces (e.g. the pending-message detail modal).
 *
 * Renders content highlighted for its language inside a WebView (native) / iframe (web)
 * so the text is natively selectable and scrolls internally. The host controls
 * the size — give this a bounded-height container; it fills it.
 */

interface TokenRule {
    selector: string;
    color?: { light: string; dark: string };
    extra?: string;
}

const TOKEN_RULES: TokenRule[] = [
    { selector: '.tok-keyword, .tok-macroName, .tok-labelName', color: { light: '#af00db', dark: '#c586c0' } },
    { selector: '.tok-comment', color: { light: '#008000', dark: '#6a9955' }, extra: 'font-style: italic;' },
    { selector: '.tok-string, .tok-string2, .tok-attributeValue', color: { light: '#a31515', dark: '#ce9178' } },
    { selector: '.tok-number', color: { light: '#098658', dark: '#b5cea8' } },
    { selector: '.tok-bool, .tok-atom, .tok-literal', color: { light: '#0000ff', dark: '#569cd6' } },
    { selector: '.tok-meta, .tok-namespace, .tok-variableName, .tok-propertyName, .tok-attributeName', color: { light: '#001080', dark: '#9cdcfe' } },
    { selector: '.tok-operator, .tok-punctuation', color: { light: '#1f2328', dark: '#d4d4d4' } },
    { selector: '.tok-link, .tok-url', color: { light: '#0366d6', dark: '#569cd6' }, extra: 'text-decoration: underline;' },
    { selector: '.tok-heading', color: { light: '#800000', dark: '#4ec9b0' }, extra: 'font-weight: bold;' },
    { selector: '.tok-typeName, .tok-className', color: { light: '#267f99', dark: '#4ec9b0' } },
    { selector: '.tok-inserted', color: { light: '#098658', dark: '#4ec9b0' } },
    { selector: '.tok-deleted', color: { light: '#b31d28', dark: '#f48771' } },
    { selector: '.tok-invalid', color: { light: '#b31d28', dark: '#f48771' }, extra: 'text-decoration: underline;' },
    { selector: '.tok-tagName', color: { light: '#800000', dark: '#569cd6' } },
    { selector: '.tok-emphasis', extra: 'font-style: italic;' },
    { selector: '.tok-strong', extra: 'font-weight: bold;' },
    { selector: '.tok-monospace', extra: `font-family: ${MONO_FONT_STACK};` },
];

function highlightCss(isDark: boolean): string {
    return TOKEN_RULES.map(r => {
        const decls: string[] = [];
        if (r.color) decls.push(`color: ${isDark ? r.color.dark : r.color.light};`);
        if (r.extra) decls.push(r.extra);
        return `${r.selector} { ${decls.join(' ')} }`;
    }).join('\n');
}

export function buildSelectionHtml(args: {
    highlightedHtml: string;
    isDark: boolean;
    backgroundColor: string;
    textColor: string;
    bottomPadding: number;
}): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
<style>
  html, body {
    margin: 0;
    padding: 0;
    background: ${args.backgroundColor};
    color: ${args.textColor};
    -webkit-text-size-adjust: 100%;
    text-size-adjust: 100%;
  }
  body {
    padding: 16px 16px ${args.bottomPadding}px 16px;
    box-sizing: border-box;
    overflow-x: hidden;
  }
  #content {
    font-family: ${MONO_FONT_STACK};
    font-size: 14px;
    line-height: 20px;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
    cursor: text;
  }
  ${highlightCss(args.isDark)}
</style>
</head>
<body>
<div id="content">${args.highlightedHtml}</div>
</body>
</html>`;
}

// Reports the rendered content height back to the host so a modal can size its
// text area to fit short content (instead of padding it out to a fixed height).
const MEASURE_SCRIPT = `(function(){
  var last = -1;
  function report(){
    try {
      var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      // Ignore sub-pixel / scrollbar-induced ±1 jitter to avoid the box twitching.
      if (Math.abs(h - last) > 1) { last = h; window.ReactNativeWebView.postMessage(String(h)); }
    } catch (e) {}
  }
  report();
  window.addEventListener('load', report);
  if (window.ResizeObserver) { try { new ResizeObserver(report).observe(document.body); } catch (e) {} }
})(); true;`;

export function SelectableTextView({ text, language = 'markdown', bottomPadding = 16, backgroundColor, onMeasure }: {
    text: string;
    language?: string;
    bottomPadding?: number;
    /** The page behind the text; defaults to the surface. Transparent shows what the view sits on (a sheet). */
    backgroundColor?: string;
    onMeasure?: (height: number) => void;
}) {
    const { theme, rt } = useUnistyles();
    const isDark = rt.themeName === 'dark';

    const html = React.useMemo(() => {
        const highlighted = text ? highlightTextToHtml(text, language) : '';
        return buildSelectionHtml({
            highlightedHtml: highlighted,
            isDark,
            backgroundColor: backgroundColor ?? theme.colors.surface,
            textColor: theme.colors.text,
            bottomPadding,
        });
    }, [text, language, isDark, backgroundColor, theme.colors.surface, theme.colors.text, bottomPadding]);

    if (Platform.OS === 'web') {
        // react-native-webview is unsupported on web. Use a plain iframe with the same
        // srcDoc html — same content & styling as the native side.
        return (
            // @ts-ignore web-only iframe
            <iframe
                title="selectable-text"
                srcDoc={html}
                sandbox="allow-same-origin"
                onLoad={onMeasure ? (e: any) => {
                    const h = e?.target?.contentDocument?.body?.scrollHeight;
                    if (typeof h === 'number' && h > 0) onMeasure(h);
                } : undefined}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    background: 'transparent',
                    flex: 1,
                }}
            />
        );
    }

    return (
        <WebView
            originWhitelist={['*']}
            source={{ html }}
            javaScriptEnabled
            domStorageEnabled
            setSupportMultipleWindows={false}
            mixedContentMode="always"
            {...(onMeasure ? {
                injectedJavaScript: MEASURE_SCRIPT,
                onMessage: (e: { nativeEvent: { data: string } }) => {
                    const h = Number(e.nativeEvent.data);
                    if (Number.isFinite(h) && h > 0) onMeasure(h);
                },
            } : {})}
            {...(Platform.OS === 'ios' ? {
                contentInsetAdjustmentBehavior: 'never' as const,
                automaticallyAdjustContentInsets: false,
                decelerationRate: 'normal' as const,
                directionalLockEnabled: true,
            } : {})}
            style={{ flex: 1, backgroundColor: 'transparent' }}
        />
    );
}
