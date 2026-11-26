import type { ClientSideConnection } from '@agentclientprotocol/sdk';
import type { Metadata } from '@/api/types';
import { mergeAcpSessionConfigIntoMetadata } from '@/agent/acp/sessionConfigMetadata';

export type AcpModel = NonNullable<Metadata['models']>[number] & {
  /** Reasoning efforts the model takes; absent when it has no effort control. */
  efforts?: NonNullable<Metadata['thoughtLevels']>;
  /** The effort the agent picks when the model is selected. */
  defaultEffort?: string;
};

/**
 * Lists the models an ACP agent offers, with the efforts each takes, through a
 * session opened for the purpose and never prompted. An agent only reports a
 * model's efforts once it is selected, and may reset the effort to the model's
 * own default on every switch, so each model is selected in turn.
 */
export async function listAcpModels(connection: ClientSideConnection, cwd: string): Promise<AcpModel[]> {
  const { sessionId, configOptions, models } = await connection.newSession({ cwd, mcpServers: [] });
  const modelConfigId = configOptions?.find((option) => option.type === 'select' && option.category === 'model')?.id ?? 'model';
  const initialMeta = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions, models });
  const listed = initialMeta.models ?? [];
  const initialCurrentCode = initialMeta.currentModelCode;
  const result: AcpModel[] = [];

  // Track model codes still offered after switching away from the initial model.
  // An ACP agent whose default model is absent from its live catalog may synthesize
  // a temporary placeholder for `currentValue` in `newSession`; once switched to any
  // real catalog model, the agent omits that placeholder from `selected.configOptions`.
  let catalogCodesAfterSwitch: Set<string> | null = null;

  for (const model of listed) {
    const selected = await connection.setSessionConfigOption({ sessionId, configId: modelConfigId, value: model.code });
    const nextMeta = mergeAcpSessionConfigIntoMetadata({} as Metadata, { configOptions: selected.configOptions });
    const { thoughtLevels, currentThoughtLevelCode } = nextMeta;
    result.push(thoughtLevels?.length ? { ...model, efforts: thoughtLevels, defaultEffort: currentThoughtLevelCode } : model);

    if (initialCurrentCode && model.code !== initialCurrentCode && nextMeta.models?.length) {
      catalogCodesAfterSwitch ??= new Set();
      for (const offered of nextMeta.models) {
        catalogCodesAfterSwitch.add(offered.code);
      }
    }
  }

  if (initialCurrentCode && catalogCodesAfterSwitch && !catalogCodesAfterSwitch.has(initialCurrentCode)) {
    return result.filter((model) => model.code !== initialCurrentCode);
  }
  return result;
}
