import { useSyncExternalStore } from 'react';
import { getModelCatalog, onModelCatalogChanged, type ModelCatalog } from 'happy-wire';

/**
 * The active model catalog. Components that build model pickers or labels from
 * happy-wire's catalog helpers call this so they re-render when a machine
 * reports the models its CLIs offer (see sync/cliModelSync) — pass the returned
 * catalog as a memo dependency wherever those helpers run inside useMemo.
 */
export function useModelCatalog(): ModelCatalog {
    return useSyncExternalStore(onModelCatalogChanged, getModelCatalog, getModelCatalog);
}
