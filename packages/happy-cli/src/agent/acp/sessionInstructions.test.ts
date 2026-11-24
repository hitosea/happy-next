import { describe, expect, it } from 'vitest';
import { buildAcpFirstTurnPrompt, stripAcpSessionInstructions } from './sessionInstructions';

describe('Qoder first-turn prompt', () => {
  it('appends the guidance after the user message so qodercli keeps it in the replayed history', () => {
    const prompt = buildAcpFirstTurnPrompt({ userMessage: 'Fix the bug', appendSystemPrompt: 'System', firstTurnInstruction: 'Set a title' });
    expect(prompt).toBe('Fix the bug\n\n<happy-session-instructions>\nSystem\n\nSet a title\n</happy-session-instructions>');
  });

  it('sends the user message unchanged when there is no guidance', () => {
    expect(buildAcpFirstTurnPrompt({ userMessage: 'Fix the bug', appendSystemPrompt: null, firstTurnInstruction: '' })).toBe('Fix the bug');
  });

  it('strips the guidance back to the user message', () => {
    const prompt = buildAcpFirstTurnPrompt({ userMessage: 'Fix the bug', firstTurnInstruction: 'Set a title' });
    expect(stripAcpSessionInstructions(prompt)).toBe('Fix the bug');
    expect(stripAcpSessionInstructions('Plain message')).toBe('Plain message');
  });
});
