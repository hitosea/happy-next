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
  'conversation_id',
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

export function extractGeminiSessionId(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  // Try full JSON parse first (pretty-printed output)
  try {
    const sessionId = readJsonSessionId(JSON.parse(trimmed));
    if (sessionId) {
      return sessionId;
    }
  } catch (_error) {
    // not a single JSON document, try line-based
  }

  // Fallback: scan individual lines
  for (const line of stdout.split(/\r?\n/)) {
    const result = extractGeminiSessionIdFromJsonLine(line);
    if (result) {
      return result;
    }
  }

  return null;
}

export function extractGeminiSessionIdFromJsonLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return readJsonSessionId(JSON.parse(trimmed));
  } catch (_error) {
    return null;
  }
}

/** Gemini names its session `session_id`; Antigravity's print mode calls it `conversation_id`. */
function readJsonSessionId(parsed: unknown): string | null {
  const { session_id, conversation_id } = (parsed ?? {}) as { session_id?: unknown; conversation_id?: unknown };
  const sessionId = [session_id, conversation_id].find((value): value is string => typeof value === 'string')?.trim();
  return sessionId || null;
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

/**
 * Gemini's JSON output carries the answer under `response` next to metadata (stats, models, ...).
 * When it is there only that is the result; other shapes fall back to collecting every text field.
 */
function collectGeminiResultCandidates(document: unknown, out: string[]): void {
  if (document && typeof document === 'object' && !Array.isArray(document) && 'response' in document) {
    collectGeminiTextCandidates((document as Record<string, unknown>).response, out);
    return;
  }
  collectGeminiTextCandidates(document, out);
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
    collectGeminiResultCandidates(parsed, candidates);
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
        collectGeminiResultCandidates(parsed, candidates);
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

/**
 * Antigravity runs in stream-json print mode, whose first line already names the conversation so a
 * running task can be followed. The answer is the closing `result` event's `response`; without it
 * (a cut-off run) it is the reply text streamed so far, and a whole JSON document is read as Gemini's.
 */
export function normalizeAntigravityOutputText(stdout: string): string {
  const events = stdout.split(/\r?\n/).flatMap((line): Record<string, any>[] => {
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed.event === 'string' ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const response = events.find((event) => event.event === 'result' && typeof event.result?.response === 'string')?.result.response as string | undefined;
  const streamed = events
    .filter((event) => event.step_update?.step_type === 'agent_response' && typeof event.step_update.text_delta === 'string')
    .map((event) => event.step_update.text_delta as string)
    .join('');
  return (response ?? streamed).trim() || (events.length === 0 ? normalizeGeminiOutputText(stdout) : '');
}
