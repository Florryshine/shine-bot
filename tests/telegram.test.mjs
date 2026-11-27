// tests/telegram.test.mjs — Telegram client: 429 retry-after handling,
// permanent-failure detection; AI client: model fallback chain + retries.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key-not-real';

const telegramMod = await import('../lib/telegram/client.js');
const aiMod = await import('../lib/ai/client.js');
const config = (await import('../lib/config.js')).default;

function makeAxios(responses) {
  // responses: array of {status?, data?, throwNetwork?} consumed in order.
  const calls = [];
  const impl = {
    calls,
    post: async (url, body) => {
      calls.push({ url, body });
      const r = responses.shift() || { status: 200, data: { ok: true, result: { message_id: 1 } } };
      if (r.throwNetwork) throw new Error('socket hang up');
      if (r.status && r.status !== 200) {
        const err = new Error(r.data?.description || 'http error');
        err.response = { status: r.status, data: r.data };
        throw err;
      }
      return { data: r.data };
    },
  };
  return impl;
}

test('telegram apiCall: retries on 429 honoring retry_after, then succeeds', async () => {
  const axiosLike = makeAxios([
    { status: 429, data: { description: 'Too Many Requests', parameters: { retry_after: 0 } } },
    { status: 200, data: { ok: true, result: { message_id: 42 } } },
  ]);
  const result = await telegramMod.apiCall(axiosLike, 'TOKEN', 'sendMessage', { chat_id: 1, text: 'hi' });
  assert.equal(result.result.message_id, 42);
  assert.equal(axiosLike.calls.length, 2, 'retried once');
});

test('telegram apiCall: bot-blocked (403) is permanent — no retries', async () => {
  const axiosLike = makeAxios([
    { status: 403, data: { description: 'Forbidden: bot was blocked by the user' } },
  ]);
  await assert.rejects(
    () => telegramMod.apiCall(axiosLike, 'TOKEN', 'sendMessage', { chat_id: 2, text: 'hi' }),
    (err) => err.permanent === true && axiosLike.calls.length === 1
  );
});

test('telegram apiCall: gives up after retry limit on persistent 500s', async () => {
  const axiosLike = makeAxios([
    { status: 500, data: { description: 'Internal Server Error' } },
    { status: 500, data: { description: 'Internal Server Error' } },
    { status: 500, data: { description: 'Internal Server Error' } },
    { status: 500, data: { description: 'Internal Server Error' } },
  ]);
  await assert.rejects(() => telegramMod.apiCall(axiosLike, 'TOKEN', 'sendMessage', { chat_id: 3, text: 'hi' }, { maxRetries: 3 }));
  assert.equal(axiosLike.calls.length, 4, 'initial + 3 retries');
});

test('groq-sdk availability sanity (Phase 2): package installed and version ^1.6.0 line present', async () => {
  const fs = await import('node:fs');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.dependencies['groq-sdk'], /\^1\./);
  const mod = await import('groq-sdk');
  assert.ok(mod.Groq, 'Groq class exported');
});

test('AI client: retired model id falls through the fallback chain automatically', async () => {
  const responses = [
    () => { const e = new Error("The model `llama-3.3-70b-versatile` does not exist or you do not have access to it."); e.status = 404; throw e; },
    () => ({ choices: [{ message: { content: 'fallback answer' } }], usage: { total_tokens: 10 } }),
  ];
  const groqLike = {
    chat: { completions: { create: async () => { const r = responses.shift(); return await r(); } } },
  };
  const res = await aiMod.callAI({
    messages: [{ role: 'user', content: 'hi' }],
    model: 'llama-3.3-70b-versatile',
    maxTokens: 50,
    label: 'test',
  }, { groqLike });
  assert.equal(res.content, 'fallback answer');
  assert.equal(res.model, config.modelFallbacks[0], 'used first fallback');
});

test('AI client: transient 500 retries then succeeds on the same model', async () => {
  let attempts = 0;
  const groqLike = {
    chat: {
      completions: {
        create: async () => {
          attempts++;
          if (attempts === 1) {
            const e = new Error('Internal error');
            e.status = 500;
            throw e;
          }
          return { choices: [{ message: { content: 'ok' } }], usage: {} };
        },
      },
    },
  };
  const res = await aiMod.callAI({ messages: [{ role: 'user', content: 'hi' }], model: 'openai/gpt-oss-120b', label: 'test' }, { groqLike });
  assert.equal(res.content, 'ok');
  assert.equal(attempts, 2);
});

test('AI client: empty completion is treated as failure (falls through / throws)', async () => {
  const groqLike = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: '' } }], usage: {} }),
      },
    },
  };
  // Both chain models return empty → final throw.
  await assert.rejects(
    () => aiMod.callAI({ messages: [{ role: 'user', content: 'hi' }], model: 'openai/gpt-oss-120b', label: 'test' }, { groqLike })
  );
});
