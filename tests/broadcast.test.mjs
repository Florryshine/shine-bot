// tests/broadcast.test.mjs — Phase 5: draft → preview → CONFIRM/CANCEL →
// delivery with eligibility filtering, per-student records, duplicate-safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_GROUP_ID = '-100999';
process.env.ADMIN_TELEGRAM_IDS = '111';
process.env.STORE_TYPE = 'memory';
process.env.BROADCAST_SEND_DELAY_MS = '1';

const { makeBroadcastEngine } = await import('../lib/broadcast.js');
const { makeMemoryStore } = await import('../lib/store/memoryStore.js');
const { makeFakeTelegram, ADMIN_GROUP_ID, FLORRY_ID } = await import('./helpers.mjs');

const STUDENTS = [
  { row_number: 2, name: 'Ada', telegram_id: '555000111', status: 'active' },
  { row_number: 3, name: 'Bola', telegram_id: '666000222', status: 'active' },
  { row_number: 4, name: 'Tunde', telegram_id: '777000333', status: 'silent' }, // opted out
  { row_number: 5, name: 'Zainab', telegram_id: '888000444', status: 'inactive' },
  { row_number: 6, name: 'NoId', telegram_id: '', status: 'active' }, // unreachable
];

function makeEngine() {
  const store = makeMemoryStore();
  const telegram = makeFakeTelegram();
  const engine = makeBroadcastEngine({
    store, telegram,
    getStudentsFn: async () => STUDENTS,
  });
  return { store, telegram, engine };
}

const adminUser = { id: FLORRY_ID, first_name: 'Florry' };
const groupMsg = (overrides = {}) => ({
  message_id: Math.floor(Math.random() * 10000),
  chat: { id: Number(ADMIN_GROUP_ID), type: 'supergroup' },
  from: adminUser,
  ...overrides,
});

test('flow: /broadcast → text draft → preview with CONFIRM/CANCEL buttons', async () => {
  const { engine, telegram, store } = makeEngine();
  const consumed = await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  assert.equal(consumed, true);
  assert.equal((await store.getCommandState(FLORRY_ID)).phase, 'awaiting_content');

  await engine.handleMessage(groupMsg({ text: 'Mock exam holds Saturday 9am!' }), adminUser, true);
  const state = await store.getCommandState(FLORRY_ID);
  assert.equal(state.phase, 'confirm');
  assert.equal(state.draft.contentType, 'text');
  assert.equal(state.draft.content, 'Mock exam holds Saturday 9am!');
  const preview = telegram.calls.find((c) => c.method === 'sendWithButtons');
  assert.ok(preview, 'preview sent');
  const labels = preview.args.buttons[0].map((b) => b.text);
  assert.deepEqual(labels, ['✅ CONFIRM', '❌ CANCEL']);
});

test('flow: CONFIRM delivers to eligible students only + report + delivery log', async () => {
  const { engine, telegram, store } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  await engine.handleMessage(groupMsg({ text: 'Test broadcast!' }), adminUser, true);

  const result = await engine.handleBroadcastCallback({
    data: 'bc_confirm', from: adminUser, id: 'cq1',
    message: { chat: { id: Number(ADMIN_GROUP_ID) }, message_id: 5000 },
  });
  assert.equal(result.action, 'delivered');
  assert.equal(result.result.sent, 2); // Ada + Bola; silent/inactive/empty excluded
  assert.equal(result.result.failed, 0);

  const delivered = telegram.calls.filter((c) => c.method === 'sendMessage' && ['555000111', '666000222'].includes(String(c.args.chat_id)));
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every((c) => c.args.text.includes('Test broadcast!')));
  assert.ok(telegram.calls.filter((c) => String(c.args.chat_id) === '777000333').length === 0, 'silent student excluded');
  assert.ok(telegram.calls.filter((c) => String(c.args.chat_id) === '888000444').length === 0, 'inactive student excluded');

  const report = telegram.calls.filter((c) => String(c.args.chat_id) === ADMIN_GROUP_ID).map((c) => c.args.text).join(' ');
  assert.ok(report.includes('Delivered: 2'), 'report in admin group');
  const hist = await store.getBroadcastHistory(5);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].status, 'completed');
});

test('flow: redelivered CONFIRM callback is a no-op (duplicate prevention)', async () => {
  const { engine, telegram } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  await engine.handleMessage(groupMsg({ text: 'Once only!' }), adminUser, true);

  const cq = { data: 'bc_confirm', from: adminUser, id: 'cqX', message: { chat: { id: Number(ADMIN_GROUP_ID) }, message_id: 5100 } };
  await engine.handleBroadcastCallback(cq);
  const sendsAfterFirst = telegram.calls.filter((c) => c.method === 'sendMessage' && String(c.args.chat_id) === '555000111').length;
  assert.equal(sendsAfterFirst, 1);

  const second = await engine.handleBroadcastCallback(cq);
  assert.equal(second.action, 'noop');
  assert.equal(telegram.calls.filter((c) => c.method === 'sendMessage' && String(c.args.chat_id) === '555000111').length, 1, 'no duplicate delivery');
});

test('flow: CANCEL sends nothing', async () => {
  const { engine, telegram, store } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  await engine.handleMessage(groupMsg({ text: 'Should not go out' }), adminUser, true);
  const result = await engine.handleBroadcastCallback({
    data: 'bc_cancel', from: adminUser, id: 'cq2',
    message: { chat: { id: Number(ADMIN_GROUP_ID) }, message_id: 5200 },
  });
  assert.equal(result.action, 'cancelled');
  assert.equal((await store.getCommandState(FLORRY_ID)), null);
  assert.equal(telegram.calls.filter((c) => ['555000111', '666000222'].includes(String(c.args.chat_id))).length, 0);
  assert.equal(await store.getBroadcastHistory(5).then((h) => h.length), 0);
});

test('media broadcast: voice note draft is delivered as a voice note', async () => {
  const { engine, telegram } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  await engine.handleMessage(groupMsg({ voice: { file_id: 'VOICE1', duration: 12 }, caption: 'Listen up!' }), adminUser, true);
  const result = await engine.handleBroadcastCallback({
    data: 'bc_confirm', from: adminUser, id: 'cq3',
    message: { chat: { id: Number(ADMIN_GROUP_ID) }, message_id: 5300 },
  });
  assert.equal(result.result.sent, 2);
  assert.ok(telegram.calls.some((c) => c.method === 'sendVoice' && c.args.voice === 'VOICE1' && String(c.args.chat_id) === '555000111'));
});

test('/broadcast <text> one-liner goes through preview too (no accidental broadcast)', async () => {
  const { engine, store, telegram } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast quick notice' }), adminUser, true);
  const state = await store.getCommandState(FLORRY_ID);
  assert.equal(state.phase, 'confirm', 'stops at preview — nothing delivered yet');
  assert.equal(telegram.calls.filter((c) => ['555000111', '666000222'].includes(String(c.args.chat_id))).length, 0);
});

test('/cancel aborts a draft; ordinary chatter never enters the machine', async () => {
  const { engine, store, telegram } = makeEngine();
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  assert.equal(await engine.handleMessage(groupMsg({ text: '/cancel' }), adminUser, true), true);
  assert.equal(await store.getCommandState(FLORRY_ID), null);
  assert.ok(!telegram.calls.some((c) => c.method === 'sendWithButtons'));

  const consumedChatter = await engine.handleMessage(groupMsg({ text: 'Florry, look at this result' }), adminUser, true);
  assert.equal(consumedChatter, false, 'ordinary message not swallowed');
});

test('failure tracking: blocked student recorded as failed with reason', async () => {
  const { engine, telegram } = makeEngine();
  // Make sends to Bola permanently fail (blocked the bot).
  const origSend = telegram.sendMessage;
  telegram.sendMessage = async (chatId, text, extra) => {
    if (String(chatId) === '666000222') {
      const err = new Error('permanent-failure: bot was blocked by the user');
      err.permanent = true;
      throw err;
    }
    return origSend(chatId, text, extra);
  };
  await engine.handleMessage(groupMsg({ text: '/broadcast' }), adminUser, true);
  await engine.handleMessage(groupMsg({ text: 'Hello class!' }), adminUser, true);
  const result = await engine.handleBroadcastCallback({
    data: 'bc_confirm', from: adminUser, id: 'cq4',
    message: { chat: { id: Number(ADMIN_GROUP_ID) }, message_id: 5400 },
  });
  assert.equal(result.result.sent, 1);
  assert.equal(result.result.failed, 1);
  assert.ok(result.result.failures[0].reason.includes('blocked'));
  const report = telegram.calls.map((c) => c.args.text).join(' ');
  assert.ok(report.includes('Failure reasons'));
});
