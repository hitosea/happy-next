/** Package that provides Codex, run through npx when no local `codex` is installed. */
export const CODEX_PACKAGE = '@openai/codex';

/**
 * Codex package spec to run. Happy runs the local `codex` (or the latest release through npx,
 * see codexRuntime); HAPPY_CODEX_PACKAGE can pin an exact version, e.g. `@openai/codex@0.170.0`.
 */
export function codexPackage(): string {
    return process.env.HAPPY_CODEX_PACKAGE ?? CODEX_PACKAGE;
}
