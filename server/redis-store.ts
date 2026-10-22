import { createClient } from '@redis/client';
import type { Store } from './redis-lobby.ts';

const DEL_IF = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Store over a Redis URL (Upstash's REDIS_URL from the Vercel Marketplace, or any Redis 6+). */
export function redisStore(url: string): Store {
  const client = createClient({ url });
  const sub = client.duplicate();
  client.on('error', (e: unknown) => console.error('redis', e instanceof Error ? e.message : 'error'));
  sub.on('error', (e: unknown) => console.error('redis sub', e instanceof Error ? e.message : 'error'));
  const ready = Promise.all([client.connect(), sub.connect()]);

  return {
    async get(key) {
      await ready;
      const v = await client.get(key);
      return typeof v === 'string' ? v : null;
    },
    async set(key, value, ttlMs, onlyIfNew) {
      await ready;
      const r = await client.set(key, value, { expiration: { type: 'PX', value: ttlMs }, ...(onlyIfNew ? { condition: 'NX' as const } : {}) });
      return r === 'OK';
    },
    async del(key) {
      await ready;
      await client.del(key);
    },
    async delIf(key, value) {
      await ready;
      await client.eval(DEL_IF, { keys: [key], arguments: [value] });
    },
    async publish(channel, message) {
      await ready;
      await client.publish(channel, message);
    },
    async subscribe(channel, fn) {
      await ready;
      await sub.subscribe(channel, (message) => fn(String(message)));
    },
    async unsubscribe(channel) {
      await ready;
      await sub.unsubscribe(channel);
    },
  };
}
