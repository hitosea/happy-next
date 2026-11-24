import { ORCHESTRATOR_ENV_KEYS } from '@/orchestrator/common';
import { QODER_RESUME_SESSION_ID_ENV } from '@/qoder/constants';
import { ANTIGRAVITY_RESUME_SESSION_ID_ENV } from '@/antigravity/constants';

// Variables that belong to one session: the daemon sets them for the session it spawns, and the
// agent running in it (Claude Code) adds its own. A daemon started from inside a session — `happy
// daemon start` run by the agent, or by a script it ran — inherits them, and every session, task
// and command it spawns would then resume that session under its title.
const sessionEnvKeys = [
  'HAPPY_CLAUDE_RESUME_SESSION_ID',
  'HAPPY_CLAUDE_SKIP_FORK_SESSION',
  'HAPPY_CLAUDE_BACKFILL',
  'HAPPY_CLAUDE_BACKFILL_MAX_USER_MESSAGES',
  'HAPPY_GEMINI_RESUME_SESSION_ID',
  'HAPPY_GEMINI_BACKFILL',
  QODER_RESUME_SESSION_ID_ENV,
  ANTIGRAVITY_RESUME_SESSION_ID_ENV,
  'HAPPY_CODEX_RESUME_FILE',
  'HAPPY_CODEX_BACKFILL',
  'HAPPY_SESSION_TITLE',
  'HAPPY_FORKED_FROM_SESSION_ID',
  'HAPPY_FORKED_FROM_TITLE',
  'HAPPY_FORKED_FROM_CONTEXT_WINDOW_SIZE',
  'HAPPY_WORKTREE_BASE_PATH',
  'HAPPY_WORKTREE_BRANCH_NAME',
  'HAPPY_WORKSPACE_REPOS',
  'HAPPY_WORKSPACE_PATH',
  'HAPPY_EXTRA_MCP_SERVERS',
  ...Object.values(ORCHESTRATOR_ENV_KEYS),
  'CLAUDECODE',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
];

/** Removes the variables of the session the daemon may have been started from. */
export function dropSessionEnv(env: NodeJS.ProcessEnv): void {
  for (const key of sessionEnvKeys) {
    delete env[key];
  }
}
