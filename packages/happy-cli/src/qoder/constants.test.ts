import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isQoderAuthError, resolveQoderCommand } from './constants';

function makeHome(...binaries: string[]): string {
  const home = mkdtempSync(join(tmpdir(), 'qoder-home-'));
  mkdirSync(join(home, '.local', 'bin'), { recursive: true });
  for (const name of binaries) writeFileSync(join(home, '.local', 'bin', name), '');
  return home;
}

describe('resolveQoderCommand', () => {
  it('prefers HAPPY_QODER_PATH', () => {
    expect(resolveQoderCommand({ HAPPY_QODER_PATH: '/custom/qodercli', HOME: makeHome('qodercli') })).toBe('/custom/qodercli');
  });

  it('finds the installer entry in ~/.local/bin when PATH lacks it', () => {
    const home = makeHome('qodercli', 'qoderclicn');
    expect(resolveQoderCommand({ PATH: '', HOME: home })).toBe(join(home, '.local', 'bin', 'qodercli'));
  });

  it('prefers the China build on a Qoder CN host', () => {
    const home = makeHome('qodercli', 'qoderclicn');
    expect(resolveQoderCommand({ PATH: '', HOME: home, QODER_PRODUCT_ID: 'qoder-cn' })).toBe(join(home, '.local', 'bin', 'qoderclicn'));
  });

  it('falls back to the bare name so the spawn error names it', () => {
    expect(resolveQoderCommand({ PATH: '', HOME: makeHome() })).toBe('qodercli');
  });
});

describe('isQoderAuthError', () => {
  it('recognises the not-signed-in error', () => {
    expect(isQoderAuthError('Error: Authentication required')).toBe(true);
    expect(isQoderAuthError('Rate limited')).toBe(false);
  });
});
