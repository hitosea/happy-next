const GEMINI_TEXT_KEYS = new Set([
  'text',
  'content',
  'output',
  'message',
  'response',
  'result',
  'answer',
  'final_text',
]);

const GEMINI_META_KEYS = new Set([
  'session_id',
  'sessionId',
  'id',
  'usage',
  'metadata',
  'model',
  'role',
  'timestamp',
]);

const ANSI_ESCAPE_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_REGEX, '');
}

const GEMINI_SESSION_ID_FIELDS = ['session_id'] as const;

/** First field present on `value` as a non-empty string, per the caller's spelling list. */
function sessionIdFromValue(value: unknown, fields: readonly string[]): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const field of fields) {
    const candidate = record[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function extractCodexSessionId(output: string): string | null {
  const cleaned = stripAnsi(output);
  const match = cleaned.match(/session id:\s*([^\s]+)/i);
  if (!match) {
    return null;
  }

  const token = match[1].trim().replace(/^['"`(\[]+|[)\]"'`,.;:]+$/g, '');
  if (!/^[0-9a-zA-Z-]{8,}$/.test(token)) {
    return null;
  }
  return token;
}

export function extractSessionIdFromJsonLine(line: string, fields: readonly string[]): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return sessionIdFromValue(JSON.parse(trimmed), fields);
  } catch (_error) {
    return null;
  }
}

/**
 * Session id from a CLI's whole stdout: the document itself, else any line of it.
 * Callers pass the field spellings their CLI uses.
 */
export function extractSessionId(stdout: string, fields: readonly string[]): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  // Try full JSON parse first (pretty-printed output)
  try {
    const sessionId = sessionIdFromValue(JSON.parse(trimmed), fields);
    if (sessionId) {
      return sessionId;
    }
  } catch (_error) {
    // not a single JSON document, try line-based
  }

  // Fallback: scan individual lines
  for (const line of stdout.split(/\r?\n/)) {
    const result = extractSessionIdFromJsonLine(line, fields);
    if (result) {
      return result;
    }
  }

  return null;
}

export function extractGeminiSessionId(stdout: string): string | null {
  return extractSessionId(stdout, GEMINI_SESSION_ID_FIELDS);
}

export function extractGeminiSessionIdFromJsonLine(line: string): string | null {
  return extractSessionIdFromJsonLine(line, GEMINI_SESSION_ID_FIELDS);
}

function collectGeminiTextCandidates(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeminiTextCandidates(item, out);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (GEMINI_META_KEYS.has(key)) {
      continue;
    }

    if (GEMINI_TEXT_KEYS.has(key)) {
      collectGeminiTextCandidates(child, out);
      continue;
    }

    if (key === 'parts' && Array.isArray(child)) {
      collectGeminiTextCandidates(child, out);
      continue;
    }

    // Traverse unknown keys as fallback for future JSON format changes
    collectGeminiTextCandidates(child, out);
  }
}

export function normalizeGeminiOutputText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return '';
  }

  const candidates: string[] = [];
  let sawJson = false;

  try {
    const parsed = JSON.parse(trimmed);
    sawJson = true;
    collectGeminiTextCandidates(parsed, candidates);
  } catch (_error) {
    // not a single JSON document, try line-based json output next
  }

  if (!sawJson) {
    for (const line of stdout.split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      try {
        const parsed = JSON.parse(trimmedLine);
        sawJson = true;
        collectGeminiTextCandidates(parsed, candidates);
      } catch (_error) {
        // ignore non-json line
      }
    }
  }

  if (!sawJson) {
    return trimmed;
  }

  const unique = [...new Set(candidates)];
  return unique.join('\n').trim();
}

// --- Qoder -------------------------------------------------------------------
//
// Qoder's headless mode is `qoder -p ... --output-format json`. The exact field
// names in that document are NOT yet confirmed against a live, authenticated CLI
// (session/new and prompts require `qodercli login`), so these readers accept the
// spellings that are plausible for a Claude-Code-shaped payload and stay silent
// otherwise. A missed child session id only costs orchestrator resume for that
// child — the run itself still reports normally.
// Revisit once a real `--output-format json` capture is available.

const QODER_SESSION_ID_FIELDS = ['session_id', 'sessionId', 'sessionID'] as const;

export function extractQoderSessionIdFromJsonLine(line: string): string | null {
  return line.trim().startsWith('{') ? extractSessionIdFromJsonLine(line, QODER_SESSION_ID_FIELDS) : null;
}

export function extractQoderSessionId(stdout: string): string | null {
  return extractSessionId(stdout, QODER_SESSION_ID_FIELDS);
}

/**
 * Turn Qoder's JSON output into displayable text.
 *
 * Reuses the same tolerant candidate walker as Gemini rather than asserting a shape:
 * if nothing string-like can be lifted out, the raw stdout is returned so the app
 * still shows what the agent printed.
 */
export function normalizeQoderOutputText(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return '';
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    // Measured payload: `result` holds the assistant's text. Walking every string leaf
    // instead would paste `service_tier`, `stop_reason` and `subtype` into the app as if
    // they were the agent's answer.
    if (typeof parsed.result === 'string' && parsed.result.trim()) {
      return parsed.result.trim();
    }
    const candidates: string[] = [];
    collectGeminiTextCandidates(parsed, candidates);
    if (candidates.length > 0) {
      return candidates.join('\n');
    }
  } catch (_error) {
    // not JSON - show it as-is
  }
  return trimmed;
}
