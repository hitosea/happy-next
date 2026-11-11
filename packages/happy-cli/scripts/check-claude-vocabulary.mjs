#!/usr/bin/env node
/**
 * Local-only check: re-extract Claude Code's system-subtype names from the installed binary and
 * report any that `protocolVocabulary.ts` does not know about.
 *
 * It cannot run in CI (no Claude Code binary there) and it checks names, not behaviour. Run it after
 * updating Claude Code, then add the new names to the vocabulary and classify them in
 * `protocolCoverage.ts` — the coverage test fails until every name has a bucket.
 *
 * Usage: node scripts/check-claude-vocabulary.mjs [path-to-claude-binary]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const vocabularyPath = join(here, '..', 'src', 'claude', 'protocolVocabulary.ts');

function latestInstalledBinary() {
    const root = join(homedir(), '.local', 'share', 'claude', 'versions');
    if (!existsSync(root)) return null;
    const versions = readdirSync(root)
        .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
        .sort((a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if (pa[i] !== pb[i]) return pa[i] - pb[i];
            }
            return 0;
        });
    return versions.length ? join(root, versions[versions.length - 1]) : null;
}

function knownSystemSubtypes() {
    const source = readFileSync(vocabularyPath, 'utf8');
    const block = source.match(/export const CLAUDE_SYSTEM_SUBTYPES = \[([\s\S]*?)\] as const;/);
    if (!block) {
        console.error(`Could not read CLAUDE_SYSTEM_SUBTYPES from ${vocabularyPath}`);
        process.exit(2);
    }
    return new Set([...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
}

function installedSystemSubtypes(binary) {
    const output = execFileSync(
        'grep',
        ['-a', '-o', 'type:"system",subtype:"[a-z_]*"', binary],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return new Set(
        output
            .split('\n')
            .filter(Boolean)
            .map((line) => line.slice(line.lastIndexOf('subtype:"') + 9, -1)),
    );
}

const binary = process.argv[2] ?? latestInstalledBinary();
if (!binary || !existsSync(binary)) {
    console.error('Claude Code binary not found. Pass it as the first argument.');
    process.exit(2);
}

const known = knownSystemSubtypes();
const installed = installedSystemSubtypes(binary);
const missing = [...installed].filter((name) => !known.has(name)).sort();
const stale = [...known].filter((name) => !installed.has(name)).sort();

console.log(`Claude Code binary: ${binary}`);
console.log(`System subtypes: ${installed.size} installed, ${known.size} in the vocabulary`);

if (missing.length) {
    console.log(`\nNew (classify these in protocolCoverage.ts):\n  ${missing.join('\n  ')}`);
}
if (stale.length) {
    console.log(`\nNo longer present (may be removed from the vocabulary):\n  ${stale.join('\n  ')}`);
}
if (!missing.length && !stale.length) {
    console.log('\nIn step.');
}

process.exit(missing.length ? 1 : 0);
