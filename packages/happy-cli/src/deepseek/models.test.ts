import { describe, expect, it } from 'vitest';
import { parseModelMode } from 'happy-wire';
import {
  decodeDeepSeekModelValue,
  encodeDeepSeekModelValue,
  isUnauthenticatedDeepSeekFallback,
  normalizeDeepSeekAcpModels,
} from './models';

describe('DeepSeek ACP model codec', () => {
  it('decodes default deepseek-official tuples to bare model ids', () => {
    expect(decodeDeepSeekModelValue('["deepseek-official","deepseek-v4-pro"]')).toEqual({
      code: 'deepseek-v4-pro',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    });
  });

  it('decodes third-party provider tuples to provider/model', () => {
    expect(decodeDeepSeekModelValue('["openrouter","deepseek-r1"]')).toEqual({
      code: 'openrouter/deepseek-r1',
      provider: 'openrouter',
      model: 'deepseek-r1',
    });
  });

  it('encodes clean codes back to dsh JSON tuples using exact map first', () => {
    const rawByCode = new Map([['deepseek-flash', '["deepseek-official","deepseek-flash"]']]);
    expect(encodeDeepSeekModelValue('deepseek-flash', rawByCode)).toBe('["deepseek-official","deepseek-flash"]');
    expect(encodeDeepSeekModelValue('deepseek-v4-pro')).toBe('["deepseek-official","deepseek-v4-pro"]');
    expect(encodeDeepSeekModelValue('custom/my-model')).toBe('["custom","my-model"]');
  });

  it('escapes ModelMode separators so codes survive parseModelMode whole', () => {
    const raw = '["openrouter","deepseek/deepseek-chat-v3:free@beta%1"]';
    const decoded = decodeDeepSeekModelValue(raw);
    expect(decoded).toEqual({
      code: 'openrouter/deepseek/deepseek-chat-v3%3Afree%40beta%251',
      provider: 'openrouter',
      model: 'deepseek/deepseek-chat-v3:free@beta%1',
    });
    expect(parseModelMode(`${decoded.code}:high`, 'deepseek')).toMatchObject({ model: decoded.code, reasoningEffort: 'high' });
    expect(encodeDeepSeekModelValue(decoded.code)).toBe(raw);
    expect(decodeDeepSeekModelValue(decoded.code)).toEqual(decoded);
  });

  it('normalizes and deduplicates raw ACP model entries', () => {
    const normalized = normalizeDeepSeekAcpModels([
      { code: '["deepseek-official","deepseek-v4-flash"]', value: 'deepseek-v4-flash', efforts: [{ code: 'low', value: 'Low' }, { code: 'high', value: 'High' }], defaultEffort: 'high' },
      { code: '["deepseek-official","deepseek-v4-pro"]', value: 'DeepSeek-V4-Pro', description: 'Flagship' },
      { code: '["deepseek-official","deepseek-v4-flash"]', value: 'Duplicate' },
    ]);
    expect(normalized).toEqual([
      { code: 'deepseek-v4-flash', value: 'deepseek-v4-flash', efforts: [{ code: 'low', value: 'Low' }, { code: 'high', value: 'High' }], defaultEffort: 'high' },
      { code: 'deepseek-v4-pro', value: 'DeepSeek-V4-Pro', description: 'Flagship' },
    ]);
  });

  it('detects dsh unauthenticated single-model placeholder without hardcoding model ids', () => {
    expect(isUnauthenticatedDeepSeekFallback([
      { code: '["deepseek-official","deepseek-v4-flash"]', value: 'deepseek-v4-flash' },
    ])).toBe(true);

    expect(isUnauthenticatedDeepSeekFallback([
      { code: '["deepseek-official","deepseek-future-default"]', value: 'deepseek-future-default' },
    ])).toBe(true);

    expect(isUnauthenticatedDeepSeekFallback([
      { code: '["openrouter","custom-model"]', value: 'custom-model' },
    ])).toBe(false);

    expect(isUnauthenticatedDeepSeekFallback([
      { code: '["deepseek-official","deepseek-flash"]', value: 'DeepSeek-V4.1-Flash' },
    ])).toBe(false);
  });
});
