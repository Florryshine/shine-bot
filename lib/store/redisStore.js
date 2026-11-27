// lib/store/redisStore.js — Upstash Redis (REST) store. Recommended once the
// academy outgrows Sheets-backed mappings: O(1) lookups, native TTLs, no scans.
// Enable by setting UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
// (Vercel KV marketplaces as Upstash and exposes exactly these variables.)

import config from '../config.js';

function makeRedis({ restUrl, restToken, axiosLike }) {
  const base = restUrl.replace(/\/$/, '');
  async function exec(...command) {
    const res = await axiosLike.post(`${base}/pipeline`, [command], {
      headers: { Authorization: `Bearer ${restToken}`, 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const entry = res.data?.[0];
    if (!entry || entry.error) throw new Error(entry?.error || 'upstash pipeline error');
    return entry.result;
  }
  return {
    async get(key) {
      return exec('GET', key);
    },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds) return exec('SET', key, value, 'EX', ttlSeconds);
      return exec('SET', key, value);
    },
    async setnx(key, value, ttlSeconds) {
      const result = await exec('SET', key, value, 'NX', 'EX', ttlSeconds);
      return result === 'OK' || result === true;
    },
    async rpushTrim(key, value, maxLen, ttlSeconds) {
      await exec('RPUSH', key, value);
      const len = await exec('LLEN', key);
      if (len > maxLen) {
        await exec('LTRIM', key, len - maxLen, -1);
      }
      if (ttlSeconds) await exec('EXPIRE', key, ttlSeconds);
    },
    async lrange(key, start, stop) {
      return exec('LRANGE', key, start, stop);
    },
    async del(key) {
      return exec('DEL', key);
    },
  };
}

const TTL = {
  mapping: config.mappingRetentionDays * 24 * 60 * 60,
  conversation: config.conversationRetentionDays * 24 * 60 * 60,
  update: 7 * 24 * 60 * 60,
  commandState: 3600,
  broadcast: 90 * 24 * 60 * 60,
};

export function makeRedisStore({ restUrl = config.redisRestUrl, restToken = config.redisRestToken, axiosLike } = {}) {
  const redis = makeRedis({ restUrl, restToken, axiosLike });

  async function setJson(key, obj, ttl) {
    await redis.set(key, JSON.stringify(obj), ttl);
  }
  async function getJson(key) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  return {
    type: 'redis',
    async saveMessageMapping(m) {
      await setJson(`msgmap:${m.adminGroupId}:${m.adminMessageId}`, m, TTL.mapping);
    },
    async findMessageMapping({ adminGroupId, adminMessageId }) {
      return getJson(`msgmap:${adminGroupId}:${adminMessageId}`);
    },
    async appendConversation(studentChatId, conversationId, role, content) {
      await redis.rpushTrim(`conv:${studentChatId}`, JSON.stringify({ role, content }), 40, TTL.conversation);
    },
    async getConversation(studentChatId, limit = 12) {
      const raw = await redis.lrange(`conv:${studentChatId}`, -limit, -1);
      return raw.map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return { role: 'user', content: '' };
        }
      });
    },
    async isUpdateProcessed(updateId) {
      return !(await redis.setnx(`upd:${updateId}`, '1', TTL.update));
    },
    // setnx already claims the id; mark is a no-op kept for interface parity.
    async markUpdateProcessed(updateId) {
      await redis.set(`upd:${updateId}`, '1', TTL.update).catch(() => {});
    },
    async getCommandState(userId) {
      return getJson(`cmdstate:${userId}`);
    },
    async setCommandState(userId, state) {
      await setJson(`cmdstate:${userId}`, state, TTL.commandState);
    },
    async clearCommandState(userId) {
      await redis.del(`cmdstate:${userId}`);
    },
    async saveBroadcastRecord(rec) {
      await redis.rpushTrim('broadcasts', JSON.stringify(rec), 50, TTL.broadcast);
      await setJson(`broadcast:${rec.broadcastId}`, rec, TTL.broadcast);
    },
    async updateBroadcastRecord(broadcastId, fields) {
      const rec = await getJson(`broadcast:${broadcastId}`);
      if (rec) {
        await setJson(`broadcast:${broadcastId}`, { ...rec, ...fields }, TTL.broadcast);
      }
    },
    async getBroadcastHistory(limit = 5) {
      const list = (await redis.lrange('broadcasts', -limit, -1)).map((r) => {
        try {
          return JSON.parse(r);
        } catch {
          return null;
        }
      }).filter(Boolean);
      const withUpdates = [];
      for (const rec of list) {
        const updated = await getJson(`broadcast:${rec.broadcastId}`);
        withUpdates.push(updated || rec);
      }
      return withUpdates.reverse();
    },
    async appendBroadcastDelivery(broadcastId, delivery) {
      await redis.rpushTrim(`blog:${broadcastId}`, JSON.stringify({ ...delivery, sentAt: delivery.sentAt || new Date().toISOString() }), 1000, TTL.broadcast);
    },
  };
}

export default makeRedisStore;
