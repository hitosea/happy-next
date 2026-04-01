import { log } from "./log";

interface ShutdownEntry {
    callback: () => Promise<void>;
    phase: number;
}

const shutdownHandlers = new Map<string, ShutdownEntry[]>();
export const shutdownController = new AbortController();

export const shutdownSignal = shutdownController.signal;

/**
 * @param phase Lower phases execute first. Same-phase handlers run concurrently.
 */
export function onShutdown(name: string, callback: () => Promise<void>, phase = 0): () => void {
    if (shutdownSignal.aborted) {
        callback();
        return () => {};
    }
    
    if (!shutdownHandlers.has(name)) {
        shutdownHandlers.set(name, []);
    }
    const handlers = shutdownHandlers.get(name)!;
    const entry: ShutdownEntry = { callback, phase };
    handlers.push(entry);
    
    return () => {
        const index = handlers.indexOf(entry);
        if (index !== -1) {
            handlers.splice(index, 1);
            if (handlers.length === 0) {
                shutdownHandlers.delete(name);
            }
        }
    };
}

export function isShutdown() {
    return shutdownSignal.aborted;
}

export async function awaitShutdown() {
    await new Promise<void>((resolve) => {
        process.on('SIGINT', async () => {
            log('Received SIGINT signal. Exiting...');
            resolve();
        });
        process.on('SIGTERM', async () => {
            log('Received SIGTERM signal. Exiting...');
            resolve();
        });
    });
    shutdownController.abort();
    
    // Snapshot and group handlers by phase
    const phaseMap = new Map<number, { name: string; callback: () => Promise<void> }[]>();
    for (const [name, entries] of shutdownHandlers) {
        for (const entry of entries) {
            if (!phaseMap.has(entry.phase)) {
                phaseMap.set(entry.phase, []);
            }
            phaseMap.get(entry.phase)!.push({ name, callback: entry.callback });
        }
    }
    
    const sortedPhases = [...phaseMap.keys()].sort((a, b) => a - b);
    const startTime = Date.now();
    
    for (const phase of sortedPhases) {
        const handlers = phaseMap.get(phase)!;
        log(`Phase ${phase}: starting ${handlers.length} shutdown handlers`);
        
        const promises = handlers.map(({ name, callback }) =>
            callback().then(
                () => {},
                (error) => log(`Error in shutdown handler ${name}:`, error)
            )
        );
        await Promise.all(promises);
    }
    
    const duration = Date.now() - startTime;
    log(`All shutdown handlers completed in ${duration}ms`);
}

export async function keepAlive<T>(name: string, callback: () => Promise<T>): Promise<T> {
    let completed = false;
    let result: T;
    let error: any;
    
    const promise = new Promise<void>((resolve) => {
        const unsubscribe = onShutdown(`keepAlive:${name}`, async () => {
            if (!completed) {
                log(`Waiting for keepAlive operation to complete: ${name}`);
                await promise;
            }
        });
        
        // Run the callback
        callback().then(
            (res) => {
                result = res;
                completed = true;
                unsubscribe();
                resolve();
            },
            (err) => {
                error = err;
                completed = true;
                unsubscribe();
                resolve();
            }
        );
    });
    
    // Wait for completion
    await promise;
    
    if (error) {
        throw error;
    }
    
    return result!;
}