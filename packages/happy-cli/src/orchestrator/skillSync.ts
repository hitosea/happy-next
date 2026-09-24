import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { logger } from '@/ui/logger';
import { getCodexHomeDir } from '@/codex/utils/codexHome';
import { shouldEnableOrchestratorTools } from './prompt';
import {
  ORCHESTRATOR_SKILL_MD,
  ORCHESTRATOR_COMMAND_CLAUDE,
  ORCHESTRATOR_COMMAND_CODEX,
  ORCHESTRATOR_COMMAND_GEMINI,
  ORCHESTRATOR_COMMAND_QODER,
} from './skillAssets';

let didSync = false;

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
    logger.debug(`[orchestrator] synced skill asset: ${filePath}`);
  } catch (error) {
    logger.debug(`[orchestrator] failed to sync ${filePath}: ${error}`);
  }
}

/**
 * Sync the bundled orchestrator skill + commands into the Claude and Codex config dirs so the
 * controller session can use /orchestrator:claude|codex|gemini and the orchestrator skill out of
 * the box.
 *
 * - Idempotent: each file is written only when its content differs (no churn).
 * - Best-effort: never throws — a failed write is logged and skipped so it cannot break startup.
 * - Worker sessions are skipped (they must not orchestrate / recurse).
 * - A provider's config dir is populated only if it already exists — we never create ~/.claude,
 *   $CLAUDE_CONFIG_DIR, or $CODEX_HOME for a tool the user has not set up.
 * - Runs once per process.
 *
 * Gemini is intentionally not synced yet: its CLI uses a different command/skill format and
 * happy-cli has no Gemini skill discovery, so a Gemini controller falls back to the orchestrator
 * MCP tools + system prompt.
 */
export function syncOrchestratorAssets(): void {
  if (didSync) return;
  didSync = true;
  if (!shouldEnableOrchestratorTools()) return;

  // Claude — $CLAUDE_CONFIG_DIR or ~/.claude. Only populate it if it already exists.
  // Subdirectory under commands/ yields /orchestrator:<command>.
  const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  if (existsSync(claudeRoot)) {
    writeIfChanged(join(claudeRoot, 'skills', 'orchestrator', 'SKILL.md'), ORCHESTRATOR_SKILL_MD);
    writeIfChanged(join(claudeRoot, 'commands', 'orchestrator', 'claude.md'), ORCHESTRATOR_COMMAND_CLAUDE);
    writeIfChanged(join(claudeRoot, 'commands', 'orchestrator', 'codex.md'), ORCHESTRATOR_COMMAND_CODEX);
    writeIfChanged(join(claudeRoot, 'commands', 'orchestrator', 'gemini.md'), ORCHESTRATOR_COMMAND_GEMINI);
    writeIfChanged(join(claudeRoot, 'commands', 'orchestrator', 'qoder.md'), ORCHESTRATOR_COMMAND_QODER);
  }

  // Codex — $CODEX_HOME/skills, defaulting to ~/.codex/skills.
  // Only populate it if the configured Codex home already exists.
  const codexRoot = getCodexHomeDir();
  if (existsSync(codexRoot)) {
    writeIfChanged(join(codexRoot, 'skills', 'orchestrator', 'SKILL.md'), ORCHESTRATOR_SKILL_MD);
  }
}
