// tests/classify.test.mjs — Phase 3 routing brain: fast paths + LLM fallbacks.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-key-not-real';

const { fastPath, classifyMessage } = await import('../lib/ai/classify.js');

test('fastPath: explicit crisis language → RED immediately', () => {
  for (const t of [
    'i want to kill myself',
    'I am going to end it all tonight',
    'sometimes I think about suicide',
    'my uncle has been beating me at home',
    'I am bleeding heavily and feel faint',
  ]) {
    const r = fastPath(t);
    assert.ok(r, `should catch: ${t}`);
    assert.equal(r.category, 'red', t);
  }
});

test('fastPath: exam hyperbole does NOT short-circuit to RED (LLM judges it)', () => {
  assert.equal(fastPath('this maths wants to kill me 😭'), null);
  assert.equal(fastPath('jamb wants to kill somebody o'), null);
  assert.equal(fastPath('explain mitosis'), null);
  assert.equal(fastPath('i want to die seeing this result lol'), null);
});

test('fastPath: explicit request for Florry / a human → ORANGE', () => {
  assert.equal(fastPath('can I talk to Florry please?').category, 'orange');
  assert.equal(fastPath('I need to talk to a real person').category, 'orange');
  assert.equal(fastPath('let me speak with florryshine directly').category, 'orange');
});

test('classifyMessage: LLM result passed through (structured)', async () => {
  const groqLike = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({ category: 'green', topic: 'biology_question', is_academic: true, reason: 'subject explanation' }) } }],
          usage: { total_tokens: 42 },
        }),
      },
    },
  };
  const r = await classifyMessage({ student: { name: 'Ada' }, messageText: 'explain photosynthesis', overrides: { groqLike } });
  assert.equal(r.category, 'green');
  assert.equal(r.is_academic, true);
  assert.equal(r.source, 'llm');
});

test('classifyMessage: unknown LLM category → safe default ORANGE', async () => {
  const groqLike = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ category: 'purple', topic: 'x', is_academic: false, reason: '?' }) } }], usage: {} }) } },
  };
  const r = await classifyMessage({ student: { name: 'Ada' }, messageText: 'hello there', overrides: { groqLike } });
  assert.equal(r.category, 'orange');
});

test('classifyMessage: classifier failure → ORANGE (favour human review)', async () => {
  const groqLike = {
    chat: { completions: { create: async () => { throw new Error('boom'); } } },
  };
  const r = await classifyMessage({ student: { name: 'Ada' }, messageText: 'explain electrolysis', overrides: { groqLike } });
  assert.equal(r.category, 'orange');
  assert.equal(r.topic, 'classifier_error');
});
