import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcpBackendOptions } from '../acp/AcpBackend';

const mocks = vi.hoisted(() => ({ readGeminiLocalConfig: vi.fn(), createBackend: vi.fn() }));
vi.mock('../acp/AcpBackend', () => ({
  AcpBackend: class {
    constructor(public options: AcpBackendOptions) { mocks.createBackend(options); }
  },
}));
vi.mock('@/gemini/utils/config', () => ({
  readGeminiLocalConfig: mocks.readGeminiLocalConfig,
  determineGeminiModel: () => 'gemini-test-model',
  getGeminiModelSource: () => 'default',
}));
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));
import { createGeminiBackend } from './gemini';

const unresolvedEnvironment = {
  GEMINI_API_KEY: '${MISSING_GEMINI_KEY}',
  GOOGLE_API_KEY: '${MISSING_GOOGLE_KEY}',
  GOOGLE_APPLICATION_CREDENTIALS: '${MISSING_ADC_PATH}',
};

describe('Gemini authentication validation after credential selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of Object.keys(unresolvedEnvironment)) vi.stubEnv(name, undefined);
    mocks.readGeminiLocalConfig.mockReturnValue({
      token: null, model: null, googleCloudProject: null, googleCloudProjectEmail: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('uses local login despite unresolved profile credentials', () => {
    for (const [name, value] of Object.entries(unresolvedEnvironment)) vi.stubEnv(name, value);
    mocks.readGeminiLocalConfig.mockReturnValue({ token: 'local-test-token' });
    createGeminiBackend({ cwd: '/tmp' });
    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ GEMINI_API_KEY: 'local-test-token', GOOGLE_API_KEY: 'local-test-token' }),
    }));
  });

  it('uses the cloud token ahead of local login and unresolved profile credentials', () => {
    mocks.readGeminiLocalConfig.mockReturnValue({ token: 'local-test-token' });
    createGeminiBackend({ cwd: '/tmp', cloudToken: 'cloud-test-token', env: unresolvedEnvironment });
    expect(mocks.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ GEMINI_API_KEY: 'cloud-test-token', GOOGLE_API_KEY: 'cloud-test-token' }),
    }));
  });

  it.each(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS'])('rejects an unresolved %s when it is the credential actually used', name => {
    vi.stubEnv(name, unresolvedEnvironment[name as keyof typeof unresolvedEnvironment]);
    expect(() => createGeminiBackend({ cwd: '/tmp' })).toThrow('unresolved environment variable reference');
    expect(mocks.createBackend).not.toHaveBeenCalled();
  });

  it('ignores unresolved lower-priority variables when GEMINI_API_KEY is usable', () => {
    vi.stubEnv('GEMINI_API_KEY', 'api-test-token');
    vi.stubEnv('GOOGLE_API_KEY', unresolvedEnvironment.GOOGLE_API_KEY);
    vi.stubEnv('GOOGLE_APPLICATION_CREDENTIALS', unresolvedEnvironment.GOOGLE_APPLICATION_CREDENTIALS);
    expect(() => createGeminiBackend({ cwd: '/tmp' })).not.toThrow();
  });

  it('rejects the selected GEMINI_API_KEY even when GOOGLE_API_KEY is usable', () => {
    vi.stubEnv('GEMINI_API_KEY', unresolvedEnvironment.GEMINI_API_KEY);
    vi.stubEnv('GOOGLE_API_KEY', 'google-test-token');
    expect(() => createGeminiBackend({ cwd: '/tmp' })).toThrow('GEMINI_API_KEY');
  });

  it('validates unresolved credentials passed through backend options', () => {
    expect(() => createGeminiBackend({ cwd: '/tmp', env: { GEMINI_API_KEY: unresolvedEnvironment.GEMINI_API_KEY } }))
      .toThrow('GEMINI_API_KEY');
  });

  it('allows Gemini to authenticate itself when no explicit credentials are present', () => {
    expect(() => createGeminiBackend({ cwd: '/tmp' })).not.toThrow();
  });
});
