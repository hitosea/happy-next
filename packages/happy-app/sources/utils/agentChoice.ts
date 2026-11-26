/**
 * Qoder ships two builds of one CLI: Qoder (`qodercli`, international) and Qoder CN
 * (`qoderclicn`, China). They behave alike but sign in to different accounts, keep
 * their own conversations and offer their own models, so users see two products.
 *
 * Underneath a session is one flavor, `qoder`, plus the build it runs on. The
 * new-session picker offers them as two agents; `AgentChoice` is that picker value.
 */

import { t } from '@/text';

export type AgentType = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'deepseek' | 'qoder';
export type QoderBuild = 'intl' | 'cn';
export type AgentChoice = AgentType | 'qodercn';

export const AGENT_CHOICES: readonly AgentChoice[] = ['claude', 'codex', 'gemini', 'antigravity', 'deepseek', 'qoder', 'qodercn'];

export function isAgentChoice(value: unknown): value is AgentChoice {
    return AGENT_CHOICES.includes(value as AgentChoice);
}

/** The flavor and, for Qoder, the build a picker choice starts. */
export function resolveAgentChoice(choice: AgentChoice): { agent: AgentType; qoderBuild?: QoderBuild } {
    if (choice === 'qodercn') return { agent: 'qoder', qoderBuild: 'cn' };
    return choice === 'qoder' ? { agent: 'qoder', qoderBuild: 'intl' } : { agent: choice };
}

/** The picker choice of a session's flavor and build; a Qoder session without a build is Qoder. */
export function agentChoiceOf(agent: AgentType, qoderBuild?: QoderBuild | null): AgentChoice {
    return agent === 'qoder' && qoderBuild === 'cn' ? 'qodercn' : agent;
}

const FLAVOR_AGENTS: Record<string, AgentType> = {
    claude: 'claude',
    codex: 'codex',
    openai: 'codex',
    gpt: 'codex',
    gemini: 'gemini',
    antigravity: 'antigravity',
    deepseek: 'deepseek',
    qoder: 'qoder',
};

/** A session's agent name as the new-session picker shows it (Qoder CN for a Qoder session on the China build). */
export function agentDisplayName(flavor: string | null | undefined, qoderBuild?: QoderBuild | null): string {
    const agent = FLAVOR_AGENTS[flavor || 'claude'];
    if (agent) return t(`agentInput.agent.${agentChoiceOf(agent, qoderBuild)}`);
    return flavor ? flavor[0].toUpperCase() + flavor.slice(1) : '';
}
