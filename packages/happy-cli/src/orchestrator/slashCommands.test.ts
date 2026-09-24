import { describe, expect, it } from 'vitest';
import {
  addOrchestratorSlashCommands,
  expandOrchestratorSlashCommand,
  ORCHESTRATOR_SLASH_COMMANDS,
} from './slashCommands';

describe('orchestrator slash commands', () => {
  it('adds synthetic orchestrator slash commands without dropping existing capabilities', () => {
    const capabilities = addOrchestratorSlashCommands({
      tools: ['Bash'],
      slashCommands: ['clear'],
      slashCommandMetadata: [{ name: 'clear', kind: 'command', scope: 'SYSTEM' }],
    });

    expect(capabilities.tools).toEqual(['Bash']);
    expect(capabilities.slashCommands).toEqual(['clear', ...ORCHESTRATOR_SLASH_COMMANDS]);
    expect(capabilities.slashCommandMetadata?.map((command) => command.name)).toEqual([
      'clear',
      'orchestrator:claude',
      'orchestrator:codex',
      'orchestrator:gemini',
      'orchestrator:qoder',
    ]);
  });

  it('expands /orchestrator provider commands into delegation prompts', () => {
    const expanded = expandOrchestratorSlashCommand('/orchestrator:codex fix the failing test');

    expect(expanded?.provider).toBe('codex');
    expect(expanded?.prompt).toContain('delegate work with **codex** as the primary provider');
    expect(expanded?.prompt).toContain('fix the failing test');
    expect(expanded?.prompt).toContain('orchestrator_*');
  });

  it('ignores non-orchestrator slash commands', () => {
    expect(expandOrchestratorSlashCommand('/clear')).toBeNull();
    expect(expandOrchestratorSlashCommand('/orchestrator:unknown task')).toBeNull();
  });
});
