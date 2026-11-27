// lib/logger.js — Safe logging: never prints secrets, truncates message bodies.
// Student PII is kept to the minimum needed to debug an incident (chat id + name).

import config from './config.js';

const SECRET_PATTERNS = [
  /bot\d+:[\w-]{20,}/g, // bot token in URLs
  /gsk_[\w]+/g, // Groq key
  /"private_key"/g,
];

function redact(text) {
  let out = String(text);
  SECRET_PATTERNS.forEach((re) => {
    out = out.replace(re, '[REDACTED]');
  });
  return out;
}

function clip(text, max = 120) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const logger = {
  info(msg, meta) {
    console.log(`[shine] ${redact(msg)}${meta ? ` ${redact(JSON.stringify(meta))}` : ''}`);
  },
  warn(msg, meta) {
    console.warn(`[shine:warn] ${redact(msg)}${meta ? ` ${redact(JSON.stringify(meta))}` : ''}`);
  },
  error(msg, meta) {
    console.error(`[shine:error] ${redact(msg)}${meta ? ` ${redact(JSON.stringify(meta))}` : ''}`);
  },
  // Log a student message safely: id + name + clipped content.
  student(chatId, name, content) {
    console.log(`[shine] student chat=${config.normalizeTelegramId(chatId)} name="${clip(name, 40)}" text="${clip(content, 160)}"`);
  },
  clip,
  redact,
};

export default logger;
