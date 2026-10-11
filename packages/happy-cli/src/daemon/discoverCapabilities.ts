/**
 * Pre-session capability discovery for the new-session screen.
 *
 * A running session reports its slash commands and skills once the agent starts. The new-session
 * screen has no session yet, so the daemon reads the same on-disk sources for the chosen directory
 * and agent, letting the app offer `/` and `$` autocomplete for the first message.
 */

import os from 'node:os';
import type { SessionCapabilities } from '@/api/types';
import { discoverClaudeSlashCommandMetadata } from '@/claude/utils/slashCommandMetadata';
import { discoverCodexSkills } from '@/codex/utils/skillDiscovery';
import { addBuiltinSlashCommands } from '@/commands/builtinCommands';
import { addOrchestratorSlashCommands } from '@/orchestrator/slashCommands';
import { listQoderCommands } from '@/qoder/sessions';
import { logger } from '@/ui/logger';

export type DiscoverCapabilitiesAgent = 'claude' | 'codex' | 'gemini' | 'qoder';

export async function discoverCapabilities(
    agent: DiscoverCapabilitiesAgent,
    directory: string,
    homeDir = os.homedir(),
): Promise<SessionCapabilities> {
    // Claude picks up the built-in and orchestrator commands from ~/.claude/commands, which the
    // disk scan already covers; Codex, Gemini and Qoder get them registered by their runners instead.
    // Qoder's own commands and skills are only reported over ACP, so qodercli is asked for them.
    const discoverers: Record<DiscoverCapabilitiesAgent, () => SessionCapabilities | Promise<SessionCapabilities>> = {
        claude: () => ({ slashCommandMetadata: discoverClaudeSlashCommandMetadata(directory, homeDir) }),
        codex: () => addBuiltinSlashCommands(addOrchestratorSlashCommands({
            skills: discoverCodexSkills(directory, homeDir),
        })),
        gemini: () => addBuiltinSlashCommands({}),
        qoder: async () => {
            const commands = await listQoderCommands(directory).catch((error) => {
                logger.debug('[Qoder] Could not list commands', error);
                return [];
            });
            return addBuiltinSlashCommands({
                slashCommandMetadata: commands.map(({ name, description }) => ({ name, description, kind: 'command' as const })),
            });
        },
    };
    return discoverers[agent]();
}
