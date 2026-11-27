// lib/config.js — Central configuration. Every tunable lives here; nothing else
// reads raw env vars for these values, so the model / admin IDs / storage can be
// changed from the Vercel dashboard without touching code.

function env(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null || v === '' ? fallback : v;
}

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) ? v : fallback;
}

function parseIdList(raw) {
  return String(raw)
    .split(',')
    .map((s) => s.trim().replace(/\.0$/, ''))
    .filter(Boolean);
}

// Normalize a Telegram id that may have been mangled by Sheets into a string.
function normalizeTelegramId(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (/^\d+(\.\d+)?(e\+?\d+)?$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }
  return s.replace(/\.0$/, '');
}

const config = {
  // --- Telegram ---
  telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
  webhookSecret: env('TELEGRAM_WEBHOOK_SECRET'),
  // Private admin group where student messages are mirrored. Required for
  // forwarding / mentorship inbox; bot degrades gracefully (no forwarding) if unset.
  adminGroupId: normalizeTelegramId(env('ADMIN_GROUP_ID')),
  // Comma-separated Telegram user ids allowed to run admin commands. When empty,
  // any member of the private admin group is trusted (warned in logs).
  adminTelegramIds: parseIdList(env('ADMIN_TELEGRAM_IDS')),
  // Secret for /api/setup and /api/test-send. Required in production.
  adminApiSecret: env('ADMIN_API_SECRET'),
  // Secret for the daily cron. Vercel automatically sends it as
  // `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
  cronSecret: () => env('CRON_SECRET'),

  // --- AI (Groq) ---
  groqApiKey: env('GROQ_API_KEY'),
  // One slot per responsibility (Phase 2). Change the model from env only.
  // Defaults are production models on Groq as of 2026-11 (llama-3.3-70b-versatile
  // and llama-3.1-8b-instant are retired on self-serve tiers).
  models: {
    chat: env('GROQ_MODEL_CHAT', 'openai/gpt-oss-120b'),
    tutor: env('GROQ_MODEL_TUTOR', 'openai/gpt-oss-120b'),
    classifier: env('GROQ_MODEL_CLASSIFIER', 'openai/gpt-oss-20b'),
    escalation: env('GROQ_MODEL_ESCALATION', 'openai/gpt-oss-20b'),
    motivation: env('GROQ_MODEL_MOTIVATION', 'openai/gpt-oss-120b'),
  },
  // Ordered fallbacks used when the primary model id is retired/unavailable.
  modelFallbacks: env('GROQ_MODEL_FALLBACKS', 'openai/gpt-oss-120b,openai/gpt-oss-20b')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  aiTimeoutMs: envInt('GROQ_TIMEOUT_MS', 25000),
  aiMaxRetries: envInt('GROQ_MAX_RETRIES', 2),
  // gpt-oss reasoning effort: low = fastest WhatsApp-style answers.
  reasoningEffort: {
    chat: env('GROQ_REASONING_CHAT', 'low'),
    tutor: env('GROQ_REASONING_TUTOR', 'medium'),
    classifier: env('GROQ_REASONING_CLASSIFIER', 'low'),
    escalation: env('GROQ_REASONING_ESCALATION', 'low'),
    motivation: env('GROQ_REASONING_MOTIVATION', 'low'),
  },

  // --- Google Sheets (student records; also default persistent store) ---
  googleSheetId: env('GOOGLE_SHEET_ID'),
  googleServiceAccountCredentials: env('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS'),

  // --- Persistent store for message mappings / conversations / dedup ---
  // 'auto' (default): Redis when UPSTASH_* is configured, else Google Sheets.
  // 'memory': in-process only (dev/tests; survives only until the instance recycles).
  storeType: env('STORE_TYPE', 'auto'),
  redisRestUrl: env('UPSTASH_REDIS_REST_URL'),
  redisRestToken: env('UPSTASH_REDIS_REST_TOKEN'),

  // --- Behaviour tuning ---
  conversationHistoryTurns: envInt('CONVERSATION_HISTORY_TURNS', 12),
  mappingRetentionDays: envInt('MAPPING_RETENTION_DAYS', 30),
  conversationRetentionDays: envInt('CONVERSATION_RETENTION_DAYS', 60),
  broadcastSendDelayMs: envInt('BROADCAST_SEND_DELAY_MS', 80),
  maxBroadcastBatch: envInt('MAX_BROADCAST_BATCH', 600),

  // --- Flags ---
  isProduction: env('VERCEL_ENV', 'development') === 'production',
  botApiVersion: '2.0.0',
};

config.normalizeTelegramId = normalizeTelegramId;

// Non-fatal validation: log what is missing so the owner sees it in Vercel logs.
config.validate = function validate(logger = console) {
  const problems = [];
  const warnings = [];
  if (!config.telegramBotToken) problems.push('TELEGRAM_BOT_TOKEN is not set');
  if (!config.groqApiKey) problems.push('GROQ_API_KEY is not set');
  if (!config.googleSheetId) problems.push('GOOGLE_SHEET_ID is not set');
  if (!config.googleServiceAccountCredentials) {
    problems.push('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not set');
  }
  if (!config.adminGroupId) warnings.push('ADMIN_GROUP_ID is not set — student mirroring and mentorship inbox are disabled');
  if (!config.adminTelegramIds.length) {
    warnings.push('ADMIN_TELEGRAM_IDS is not set — any member of the admin group can run admin commands');
  }
  if (!config.webhookSecret) warnings.push('TELEGRAM_WEBHOOK_SECRET is not set — webhook is unauthenticated');
  if (!config.adminApiSecret) warnings.push('ADMIN_API_SECRET is not set — /api/setup and /api/test-send are disabled');
  problems.forEach((p) => logger.error(`[config] ${p}`));
  warnings.forEach((w) => logger.warn(`[config] ${w}`));
  return { ok: problems.length === 0, problems, warnings };
};

export default config;
