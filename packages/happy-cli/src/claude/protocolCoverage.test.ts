import { describe, expect, it } from 'vitest';
import {
    CLAUDE_MESSAGE_TYPE_COVERAGE,
    CLAUDE_RESULT_SUBTYPE_COVERAGE,
    CLAUDE_SYSTEM_SUBTYPE_COVERAGE,
    HAPPY_SYSTEM_SUBTYPE_COVERAGE,
    type Coverage,
} from './protocolCoverage';
import {
    CLAUDE_MESSAGE_TYPES,
    CLAUDE_RESULT_SUBTYPES,
    CLAUDE_SYSTEM_SUBTYPES,
    HAPPY_SYSTEM_SUBTYPES,
} from './protocolVocabulary';

const BUCKETS = new Set<Coverage['bucket']>(['shown', 'ignored', 'pending']);

function expectClassifiedExactlyOnce(vocabulary: readonly string[], coverage: Record<string, Coverage>) {
    expect(new Set(vocabulary).size).toBe(vocabulary.length);
    expect(Object.keys(coverage).sort()).toEqual([...vocabulary].sort());
    for (const name of vocabulary) {
        expect(BUCKETS.has(coverage[name].bucket), `${name} has a bad bucket`).toBe(true);
    }
}

describe('Claude protocol coverage', () => {
    it('classifies every message type', () => {
        expectClassifiedExactlyOnce(CLAUDE_MESSAGE_TYPES, CLAUDE_MESSAGE_TYPE_COVERAGE);
    });

    it('classifies every system subtype', () => {
        expectClassifiedExactlyOnce(CLAUDE_SYSTEM_SUBTYPES, CLAUDE_SYSTEM_SUBTYPE_COVERAGE);
    });

    it('classifies every result subtype', () => {
        expectClassifiedExactlyOnce(CLAUDE_RESULT_SUBTYPES, CLAUDE_RESULT_SUBTYPE_COVERAGE);
    });

    it('classifies Happy’s own system records', () => {
        expectClassifiedExactlyOnce(HAPPY_SYSTEM_SUBTYPES, HAPPY_SYSTEM_SUBTYPE_COVERAGE);
    });
});
