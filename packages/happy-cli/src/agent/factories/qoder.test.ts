import { describe, expect, it, vi } from 'vitest';
import type { AcpBackendOptions } from '../acp/AcpBackend';

const mocks = vi.hoisted(() => ({ createBackend: vi.fn() }));
vi.mock('../acp/AcpBackend', () => ({
  AcpBackend: class {
    constructor(public options: AcpBackendOptions) { mocks.createBackend(options); }
  },
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
vi.mock('@/qoder/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/qoder/constants')>()),
  resolveQoderCommand: () => '/opt/qoder/qodercli',
}));
import { createQoderBackend } from './qoder';

describe('createQoderBackend', () => {
  it('runs qodercli in ACP mode with SDK variables blanked and the resume session passed on', () => {
    const onReplayedUpdate = vi.fn();
    createQoderBackend({ cwd: '/work', env: { QODER_AGENT_SDK_ENTRYPOINT: 'desktop', KEEP: '1' }, resumeSessionId: 'abc', onReplayedUpdate });

    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'qoder',
      cwd: '/work',
      command: '/opt/qoder/qodercli',
      args: ['--acp'],
      env: expect.objectContaining({ QODER_AGENT_SDK_ENTRYPOINT: '', KEEP: '1' }),
      resumeSessionId: 'abc',
      onReplayedUpdate,
    }));
  });
});
