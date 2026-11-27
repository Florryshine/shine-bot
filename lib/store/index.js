// lib/store/index.js — Store factory. Chooses the persistent backend once per
// process: Redis when UPSTASH_* credentials exist (recommended for scale),
// Google Sheets as the default (reuses existing credentials; audited as
// acceptable at academy scale), memory for local dev/tests.

import config from '../config.js';
import logger from '../logger.js';
import makeMemoryStore from './memoryStore.js';

let cached = null;

export async function getStore({ forceType, sheetsLike, redisLike } = {}) {
  if (cached && !forceType && !sheetsLike && !redisLike) return cached;

  let type = forceType || config.storeType;
  if (type === 'auto') {
    if (config.redisRestUrl && config.redisRestToken) type = 'redis';
    else if (config.googleSheetId && config.googleServiceAccountCredentials) type = 'sheets';
    else type = 'memory';
  }

  if (type === 'redis') {
    try {
      const { makeRedisStore } = await import('./redisStore.js');
      cached = makeRedisStore({ axiosLike: redisLike });
      logger.info('store: redis (Upstash REST)');
      return cached;
    } catch (err) {
      logger.error(`redis store unavailable (${err.message}); falling back to sheets`);
      type = 'sheets';
    }
  }

  if (type === 'sheets') {
    if (!sheetsLike) {
      const { getSheets } = await import('../googleSheets.js');
      sheetsLike = await getSheets();
    }
    const { makeSheetsStore } = await import('./sheetsStore.js');
    cached = makeSheetsStore({ sheetsLike });
    logger.info('store: google sheets (bot_* tabs)');
    return cached;
  }

  cached = makeMemoryStore();
  logger.warn('store: MEMORY ONLY — data is lost on instance recycle; set STORE_TYPE or credentials');
  return cached;
}

// Test helper: drop the singleton.
export function resetStoreCache() {
  cached = null;
}
