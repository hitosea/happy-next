import { randomUUID } from "node:crypto";
import { redis } from "@/storage/redis";

const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 60;
const IDEMPOTENCY_TTL_SECONDS = 10 * 60;

const BEGIN_RELAY_SCRIPT = `
local status = redis.call('HGET', KEYS[1], 'status')
if status == 'succeeded' then
  return {'succeeded', redis.call('HGET', KEYS[1], 'deviceCount'), 0}
end
if status == 'processing' then
  return {'processing', redis.call('HGET', KEYS[1], 'deviceCount'), 0}
end
local count = redis.call('INCR', KEYS[2])
if count == 1 then
  redis.call('EXPIRE', KEYS[2], ARGV[1])
end
if count > tonumber(ARGV[2]) then
  local ttl = redis.call('TTL', KEYS[2])
  return {'rate-limited', 0, ttl}
end

if status == 'failed' then
  redis.call('HSET', KEYS[1], 'status', 'processing', 'claimId', ARGV[5])
  redis.call('EXPIRE', KEYS[1], ARGV[4])
  return {'claimed', redis.call('HGET', KEYS[1], 'deviceCount'), 0}
end

redis.call('HSET', KEYS[1],
  'status', 'processing',
  'deviceCount', ARGV[3],
  'claimId', ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return {'claimed', ARGV[3], 0}
`;

const TRANSITION_RELAY_SCRIPT = `
if redis.call('HGET', KEYS[1], 'status') ~= 'processing' then
  return 0
end
if redis.call('HGET', KEYS[1], 'claimId') ~= ARGV[1] then
  return 0
end
redis.call('HSET', KEYS[1], 'status', ARGV[2])
if ARGV[4] ~= '' then
  redis.call('HSET', KEYS[1], 'deviceCount', ARGV[4])
end
redis.call('HDEL', KEYS[1], 'claimId')
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
`;

export interface PushRelayStart {
    status: 'claimed' | 'succeeded' | 'processing' | 'rate-limited';
    deviceCount: number;
    retryAfterSeconds: number;
    claimId?: string;
}

function rateLimitKey(accountId: string): string {
    return `push-relay:rate:${accountId}`;
}

function idempotencyKey(accountId: string, requestId: string): string {
    return `push-relay:idempotency:${accountId}:${requestId}`;
}

export async function beginPushRelay(
    accountId: string,
    requestId: string,
    deviceCount: number,
): Promise<PushRelayStart> {
    const claimId = randomUUID();
    const result = await redis.eval(
        BEGIN_RELAY_SCRIPT,
        2,
        idempotencyKey(accountId, requestId),
        rateLimitKey(accountId),
        RATE_WINDOW_SECONDS,
        RATE_LIMIT,
        deviceCount,
        IDEMPOTENCY_TTL_SECONDS,
        claimId,
    ) as [string, string | number, string | number];
    const status = result[0] as PushRelayStart['status'];
    const retryAfterSeconds = Number(result[2]);
    return {
        status,
        deviceCount: Number(result[1]),
        retryAfterSeconds: status === 'rate-limited'
            ? (retryAfterSeconds > 0 ? retryAfterSeconds : RATE_WINDOW_SECONDS)
            : 0,
        ...(status === 'claimed' ? { claimId } : {}),
    };
}

async function transitionPushRelay(
    accountId: string,
    requestId: string,
    claimId: string,
    status: 'succeeded' | 'failed',
    deviceCount?: number,
): Promise<boolean> {
    const result = await redis.eval(
        TRANSITION_RELAY_SCRIPT,
        1,
        idempotencyKey(accountId, requestId),
        claimId,
        status,
        IDEMPOTENCY_TTL_SECONDS,
        deviceCount?.toString() ?? '',
    );
    return Number(result) === 1;
}

export function completePushRelay(
    accountId: string,
    requestId: string,
    claimId: string,
    deviceCount: number,
): Promise<boolean> {
    return transitionPushRelay(accountId, requestId, claimId, 'succeeded', deviceCount);
}

export function failPushRelay(
    accountId: string,
    requestId: string,
    claimId: string,
): Promise<boolean> {
    return transitionPushRelay(accountId, requestId, claimId, 'failed');
}
