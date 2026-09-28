/**
 * Qoder Transport Handler
 *
 * Qoder CLI speaks ACP cleanly through `qoder --acp`, so stdout framing, tool
 * naming and timeouts are inherited from DefaultTransport unchanged. What is agent-specific is
 * failure reporting: Qoder surfaces its two realistic startup failures as free text
 * on stderr, and both are actionable only if we name the fix.
 *
 * Verified against qoder-cli 1.1.62:
 *   - unauthenticated -> stderr "Error handling request {... Authentication required ...}"
 *     plus the JSON-RPC -32000 error on session/new and session/list
 *   - SDK-context contamination -> "sdk_invalid_args: Agent SDK entrypoint env is set"
 */

import { DefaultTransport } from '../DefaultTransport';
import type { StderrContext, StderrResult } from '../TransportHandler';
import type { AgentMessage } from '../../core';
import {
  QODER_SDK_ENTRYPOINT_ENV,
  isQoderAuthError,
  qoderAuthErrorMessage,
  qoderNpmPackageForHost,
  resolveQoderCommand,
} from '@/qoder/constants';

export class QoderTransport extends DefaultTransport {
  constructor() {
    super('qoder');
  }

  /**
   * Turn Qoder's stderr text into an actionable error status message.
   *
   * Anything we do not recognise is passed through unchanged so the raw line still
   * reaches the logs: suppressing unknown stderr is how a regression in a third-party
   * CLI becomes undebuggable.
   */
  override handleStderr(text: string, _context: StderrContext): StderrResult {
    const trimmed = text.trim();
    if (!trimmed) {
      return { message: null, suppress: true };
    }

    if (isQoderAuthError(trimmed)) {
      return {
        message: {
          type: 'status',
          status: 'error',
          detail: qoderAuthErrorMessage(resolveQoderCommand()),
        } satisfies AgentMessage,
      };
    }

    // Spawned from inside a Qoder desktop/SDK process: the entrypoint variable was
    // not cleared, so Qoder refused --acp. See qoder/constants.ts for the mechanism.
    if (trimmed.includes('sdk_invalid_args') || trimmed.includes('Agent SDK entrypoint')) {
      return {
        message: {
          type: 'status',
          status: 'error',
          detail: [
            'Qoder CLI refused ACP mode because it inherited a Qoder Agent SDK launch context.',
            `${QODER_SDK_ENTRYPOINT_ENV} must be unset (or empty) for \`qoder --acp\` to start.`,
            'Happy clears this automatically; if you see it, a spawn path is bypassing the Qoder factory.',
          ].join(' '),
        } satisfies AgentMessage,
      };
    }

    if (trimmed.includes('npm error') || trimmed.includes('E404')) {
      return {
        message: {
          type: 'status',
          status: 'error',
          detail: `Qoder CLI could not be resolved. Install it with: npm install -g ${qoderNpmPackageForHost()}`,
        } satisfies AgentMessage,
      };
    }

    return { message: null };
  }
}

export const qoderTransport = new QoderTransport();
