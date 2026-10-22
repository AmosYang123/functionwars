import { describe, expect, it } from 'vitest';
import { findRedisUrl } from './redis-store.ts';

describe('findRedisUrl', () => {
  it('prefers REDIS_URL, then KV_URL', () => {
    expect(findRedisUrl({ KV_URL: 'rediss://kv', REDIS_URL: 'rediss://main' })).toBe('rediss://main');
    expect(findRedisUrl({ KV_URL: 'redis://kv' })).toBe('redis://kv');
  });

  it('finds a Redis address under a custom prefix', () => {
    expect(findRedisUrl({ STORAGE_KV_REST_API_URL: 'https://x.upstash.io', STORAGE_URL: 'rediss://default:pw@x.upstash.io:6379' })).toBe('rediss://default:pw@x.upstash.io:6379');
  });

  it('ignores non-Redis values', () => {
    expect(findRedisUrl({ REDIS_URL: 'https://x.upstash.io', PATH: '/bin' })).toBeUndefined();
  });
});
