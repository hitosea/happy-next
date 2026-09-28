import type { SessionCapabilities } from '@/api/types';
import {
  buildOrchestratorCommandPrompt,
  ORCHESTRATOR_PROVIDERS,
  type OrchestratorProvider,
} from './skillAssets';

export const ORCHESTRATOR_SLASH_COMMAND_METADATA = ORCHESTRATOR_PROVIDERS.map((provider) => ({
  name: `orchestrator:${provider}`,
  description: `Delegate work to ${provider} agent(s)`,
  kind: 'command' as const,
  scope: 'SYSTEM' as const,
}));

export const ORCHESTRATOR_SLASH_COMMANDS = ORCHESTRATOR_SLASH_COMMAND_METADATA.map((command) => command.name);

function mergeByName<T extends { name: string }>(existing: T[] | undefined, added: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of existing ?? []) byName.set(item.name, item);
  for (const item of added) byName.set(item.name, item);
  return Array.from(byName.values());
}

function mergeStrings(existing: string[] | undefined, added: readonly string[]): string[] {
  return Array.from(new Set([...(existing ?? []), ...added]));
}

export function addOrchestratorSlashCommands(capabilities: SessionCapabilities): SessionCapabilities {
  return {
    ...capabilities,
    slashCommands: mergeStrings(capabilities.slashCommands, ORCHESTRATOR_SLASH_COMMANDS),
    slashCommandMetadata: mergeByName(
      capabilities.slashCommandMetadata,
      ORCHESTRATOR_SLASH_COMMAND_METADATA,
    ),
  };
}

export type ExpandedOrchestratorSlashCommand = {
  provider: OrchestratorProvider;
  prompt: string;
};

export function expandOrchestratorSlashCommand(message: string): ExpandedOrchestratorSlashCommand | null {
  const match = message.trim().match(/^\/orchestrator:(claude|codex|gemini|qoder)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const provider = match[1] as OrchestratorProvider;
  const task = match[2]?.trim() ?? '';
  return {
    provider,
    prompt: buildOrchestratorCommandPrompt(provider, task),
  };
}
