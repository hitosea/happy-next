// Only validate credentials consumed by the selected agent. Missing credentials
// are allowed: the agent may use its own locally persisted login.
const authVariables = {
  claude: ['ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  codex: ['OPENAI_API_KEY', 'CODEX_HOME', 'AZURE_OPENAI_API_KEY', 'TOGETHER_API_KEY'],
  // Gemini resolves cloud/local tokens in createGeminiBackend before validating.
  gemini: [],
} as const;

export function getUnexpandedSessionAuthVariables(
  environment: Record<string, string>,
  agent: 'claude' | 'codex' | 'gemini' = 'claude',
): string[] {
  return authVariables[agent].filter(name => environment[name]?.includes('${'));
}
