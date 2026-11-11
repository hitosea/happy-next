import { describe, expect, it } from 'vitest';
import { CODEX_ITEM_TYPES, CODEX_NOTIFICATIONS } from './protocolVocabulary';
import {
  HANDLED_ITEM_TYPES,
  IGNORED_ITEM_TYPES,
  PENDING_ITEM_TYPES,
  HANDLED_NOTIFICATIONS,
  IGNORED_NOTIFICATIONS,
  PENDING_NOTIFICATIONS,
} from './protocolCoverage';

function expectClassified(
  all: readonly string[],
  groups: Record<string, readonly string[]>,
): void {
  const owner = new Map<string, string>();
  for (const [group, names] of Object.entries(groups)) {
    for (const name of names) {
      const previous = owner.get(name);
      expect(previous, `${name} is in both ${previous} and ${group}`).toBeUndefined();
      owner.set(name, group);
    }
  }

  const missing = all.filter((name) => !owner.has(name));
  expect(missing, 'unclassified in protocolCoverage.ts').toEqual([]);

  const known = new Set(all);
  const extra = [...owner.keys()].filter((name) => !known.has(name));
  expect(extra, 'not in the 0.167.1 vocabulary').toEqual([]);
}

describe('Codex app-server protocol coverage', () => {
  it('pins the vocabulary of Codex 0.167.1', () => {
    // Regenerate protocolVocabulary.ts when bumping the Codex version; this count moving is the
    // reminder that the new names need a handled/ignored/pending decision.
    expect(CODEX_ITEM_TYPES).toHaveLength(19);
    expect(CODEX_NOTIFICATIONS).toHaveLength(86);
  });

  it('classifies every thread item type', () => {
    expectClassified(CODEX_ITEM_TYPES, {
      handled: HANDLED_ITEM_TYPES,
      ignored: IGNORED_ITEM_TYPES,
      pending: PENDING_ITEM_TYPES,
    });
  });

  it('classifies every server notification', () => {
    expectClassified(CODEX_NOTIFICATIONS, {
      handled: HANDLED_NOTIFICATIONS,
      ignored: IGNORED_NOTIFICATIONS,
      pending: PENDING_NOTIFICATIONS,
    });
  });
});
