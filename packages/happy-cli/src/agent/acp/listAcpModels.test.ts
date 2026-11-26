import { describe, expect, it, vi } from 'vitest';
import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import { listAcpModels } from './listAcpModels';

function makeEffortOption(current = 'high') {
  return {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue: current,
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  };
}

describe('listAcpModels', () => {
  it('drops a synthesized initial currentValue placeholder when switching away removes it from configOptions', async () => {
    const stale = { value: '["deepseek-official","stale-default"]', name: 'stale-default' };
    const flash = { value: '["deepseek-official","deepseek-flash"]', name: 'DeepSeek-V4.1-Flash' };
    const pro = { value: '["deepseek-official","deepseek-v4-pro"]', name: 'DeepSeek-V4-Pro' };

    const connection = {
      newSession: vi.fn().mockResolvedValue({
        sessionId: 's1',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: stale.value,
            options: [{ group: 'deepseek-official', name: 'DeepSeek', options: [stale, flash, pro] }],
          },
          makeEffortOption(),
        ],
      }),
      setSessionConfigOption: vi.fn().mockImplementation(async ({ value }: { value: string }) => {
        const offered = value === stale.value ? [stale, flash, pro] : [flash, pro];
        return {
          configOptions: [
            {
              id: 'model',
              name: 'Model',
              category: 'model',
              type: 'select',
              currentValue: value,
              options: [{ group: 'deepseek-official', name: 'DeepSeek', options: offered }],
            },
            makeEffortOption(),
          ],
        };
      }),
    } as unknown as ClientSideConnection;

    const models = await listAcpModels(connection, '/tmp');
    expect(models.map((m) => ({ code: m.code, value: m.value }))).toEqual([
      { code: flash.value, value: 'DeepSeek-V4.1-Flash' },
      { code: pro.value, value: 'DeepSeek-V4-Pro' },
    ]);
  });

  it('keeps the initial currentValue when it remains advertised after switching to another model', async () => {
    const flash = { value: '["deepseek-official","deepseek-flash"]', name: 'DeepSeek-V4.1-Flash' };
    const pro = { value: '["deepseek-official","deepseek-v4-pro"]', name: 'DeepSeek-V4-Pro' };

    const connection = {
      newSession: vi.fn().mockResolvedValue({
        sessionId: 's2',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: flash.value,
            options: [flash, pro],
          },
          makeEffortOption(),
        ],
      }),
      setSessionConfigOption: vi.fn().mockImplementation(async ({ value }: { value: string }) => ({
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: value,
            options: [flash, pro],
          },
          makeEffortOption(),
        ],
      })),
    } as unknown as ClientSideConnection;

    const models = await listAcpModels(connection, '/tmp');
    expect(models.map((m) => m.code)).toEqual([flash.value, pro.value]);
  });

  it('keeps all models when setSessionConfigOption returns only thought_level without model options', async () => {
    const a = { value: 'model-a', name: 'Model A' };
    const b = { value: 'model-b', name: 'Model B' };

    const connection = {
      newSession: vi.fn().mockResolvedValue({
        sessionId: 's3',
        configOptions: [
          { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: a.value, options: [a, b] },
        ],
      }),
      setSessionConfigOption: vi.fn().mockResolvedValue({
        configOptions: [makeEffortOption()],
      }),
    } as unknown as ClientSideConnection;

    const models = await listAcpModels(connection, '/tmp');
    expect(models.map((m) => m.code)).toEqual(['model-a', 'model-b']);
  });
});
