// Intercept setTimeout for the Claude Code SDK
const originalSetTimeout = global.setTimeout;

global.setTimeout = function(callback, delay, ...args) {
    // Just wrap and call the original setTimeout
    return originalSetTimeout(callback, delay, ...args);
};

// Preserve setTimeout properties
Object.defineProperty(global.setTimeout, 'name', { value: 'setTimeout' });
Object.defineProperty(global.setTimeout, 'length', { value: originalSetTimeout.length });

// Import global Claude Code CLI
const { getClaudeCliPath, getVersion, compareVersions, runClaudeCli } = require('./claude_version_utils.cjs');

const cliPath = getClaudeCliPath();

// Happy asks for --allow-dangerously-skip-permissions so a session can switch to bypassPermissions
// without a restart. Claude Code only knows it since 2.0.26 and exits on an unknown option, so drop it
// for an older or unidentified build; Happy then reaches bypass by restarting in that mode instead.
const ALLOW_BYPASS_FLAG = '--allow-dangerously-skip-permissions';
const version = getVersion(cliPath);
const flagIndex = process.argv.indexOf(ALLOW_BYPASS_FLAG);
if (flagIndex !== -1 && (!version || compareVersions(version, '2.0.26') < 0)) {
    process.argv.splice(flagIndex, 1);
}

runClaudeCli(cliPath);