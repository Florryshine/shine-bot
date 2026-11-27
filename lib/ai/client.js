// lib/ai/client.js — Single Groq entrypoint. Model ids, fallbacks, retries and
// timeouts are all centralised here so a model change never touches more than
// lib/config.js (env vars). All five responsibilities (chat, tutor, classifier,
// escalation, motivation) call this one function.

import { Groq } from 'groq-sdk';
import config from '../config.js';
import logger from '../logger.js';

let groqClient = null;

function getClient() {
  if (!groqClient) {
    if (!config.groqApiKey) throw new Error('GROQ_API_KEY is not set');
    groqClient = new Groq({ apiKey: config.groqApiKey, timeout: config.aiTimeoutMs, maxRetries: 0 });
  }
  return groqClient;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isModelError(err) {
  const msg = String(err?.message || err?.error?.message || '');
  return /does not exist|decommissioned|no longer supported|not found|do not have access/i.test(msg);
}

function isRateLimit(err) {
  return err?.status === 429 || /rate limit/i.test(String(err?.message || ''));
}

function isTransient(err) {
  const status = err?.status;
  return !status || status >= 500;
}

function extractRetryAfter(err) {
  const v = err?.error?.metadata?.retry_after ?? err?.response?.headers?.['retry-after'];
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// buildChain: requested model first, then configured fallbacks, deduped.
export function buildChain(model) {
  return [model, ...config.modelFallbacks.filter((m) => m !== model)];
}

// callAI — the one function everything uses.
// params: { messages, model, maxTokens, temperature, responseFormat, reasoningEffort, label }
export async function callAI(params, overrides = {}) {
  const { messages, model, maxTokens = 400, temperature = 0.7, responseFormat, reasoningEffort } = params;
  const label = params.label || 'ai';
  const groq = overrides.groqLike || getClient();
  const chain = buildChain(model);
  let lastError = null;

  for (const candidate of chain) {
    for (let attempt = 0; attempt <= config.aiMaxRetries; attempt++) {
      try {
        const completionParams = {
          messages,
          model: candidate,
          max_tokens: maxTokens,
          temperature,
        };
        if (responseFormat) completionParams.response_format = responseFormat;
        // reasoning_effort only applies to gpt-oss models; harmless elsewhere in
        // OpenAI-compatible APIs but we set it only for openai/* to be safe.
        if (reasoningEffort && candidate.startsWith('openai/')) {
          completionParams.reasoning_effort = reasoningEffort;
        }
        const completion = await groq.chat.completions.create(completionParams);
        const content = completion.choices?.[0]?.message?.content?.trim() || '';
        const usage = completion.usage || {};
        if (usage.total_tokens) {
          logger.info(`ai[${label}] model=${candidate} tokens=${usage.total_tokens} (in=${usage.prompt_tokens || 0} out=${usage.completion_tokens || 0})`);
        }
        if (!content) throw new Error('empty completion');
        return { content, model: candidate, usage };
      } catch (err) {
        lastError = err;
        const retryAfter = extractRetryAfter(err);
        if (isModelError(err)) {
          logger.error(`ai[${label}] model "${candidate}" unavailable: ${err.message} — trying next in chain`);
          break; // move to fallback model
        }
        if (isRateLimit(err)) {
          const waitMs = ((retryAfter ?? 2) + 1) * 1000;
          logger.warn(`ai[${label}] rate limited; retry in ${waitMs}ms`);
          await sleep(waitMs);
          continue;
        }
        if (isTransient(err) && attempt < config.aiMaxRetries) {
          await sleep(800 * (attempt + 1));
          continue;
        }
        throw err; // non-retryable (400 bad request etc.)
      }
    }
  }
  throw lastError || new Error(`ai[${label}] all models failed`);
}

// Structured-output helper (JSON schema). Groq supports json_schema structured
// outputs on gpt-oss models; falls back to json_object mode + parse guard.
export async function callAIStructured(params, schema, overrides = {}) {
  const attempt = async (format) =>
    callAI({
      ...params,
      responseFormat: format,
      temperature: params.temperature ?? 0.1,
    }, overrides);

  try {
    const res = await attempt({ type: 'json_schema', json_schema: { name: params.label || 'schema', strict: true, schema } });
    return JSON.parse(res.content);
  } catch (err) {
    logger.warn(`ai[${params.label}] json_schema failed (${err.message}); retrying with json_object`);
    const res = await attempt({ type: 'json_object' });
    const match = res.content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`ai[${params.label}] no JSON object in response`);
    return JSON.parse(match[0]);
  }
}

// Test helper.
export function setGroqClient(client) {
  groqClient = client;
}
