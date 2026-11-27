// tests/webhook.test.mjs — End-to-end offline scenarios: registration, routing,
// mentorship inbox mapping, admin reply routing (Phase 6), wrong-student
// prevention, RED escalation, authorization, dedup, secret validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_GROUP_ID = '-100999';
process.env.ADMIN_TELEGRAM_IDS = '111';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.STORE_TYPE = 'memory';
delete process.env.GROQ_API_KEY;

const { handleUpdate, processRequest } = await import('../pages/api/telegram/webhook.js');
const { makeMemoryStore } = await import('../lib/store/memoryStore.js');
const { makeFakeTelegram, makeFakeAI, makeFakeSheets, makeRes, ADMIN_GROUP_ID, FLORRY_ID, privateMessage, adminGroupMessage } = await import('./helpers.mjs');

function makeDeps({ students = [], classify } = {}) {
  const store = makeMemoryStore();
  const telegram = makeFakeTelegram();
  const ai = makeFakeAI();
  const sheets = makeFakeSheets(students);
  const broadcast = {
    handleMessage: async () => false,
    handleBroadcastCallback: async () => ({ action: 'noop' }),
  };
  const deps = { store, telegram, sheets, broadcast, ...ai };
  if (classify) deps.classify = classify;
  return { store, telegram, ai, sheets, deps };
}

const sentTo = (telegram, chatId) => telegram.calls.filter((c) => String(c.args.chat_id) === String(chatId));
const textsTo = (telegram, chatId) => sentTo(telegram, chatId).map((c) => c.args.text).filter(Boolean);

async function runStudentMessage(deps, overrides) {
  const update = privateMessage(overrides);
  return { update, result: await handleUpdate(update, deps.deps) };
}

test('new student: registration + welcome + the SAME message is answered and mirrored (audit Q8 fix)', async () => {
  const d = makeDeps(); // empty student list → auto-register
  const { result } = await runStudentMessage(d, { message: { text: 'explain photosynthesis' } });

  assert.equal(result.handled, true);
  assert.equal(result.route, 'green');
  // Student receives: welcome, help, tutor answer.
  const toStudent = textsTo(d.telegram, 555000111);
  assert.ok(toStudent.some((t) => t.startsWith('Welcome, TestStudent!')), 'welcome sent');
  assert.ok(toStudent.some((t) => t.includes("Here's what I can do for you")), 'help sent');
  assert.ok(toStudent.some((t) => t.startsWith('Tutor explanation of: explain photosynthesis')), 'academic answer via tutor mode');
  // Mirrored to admin group: student message + AI reply (mapping-bearing).
  const toAdmin = textsTo(d.telegram, ADMIN_GROUP_ID);
  assert.ok(toAdmin.some((t) => t.includes('TestStudent')), 'student message mirrored');
  assert.ok(toAdmin.some((t) => t.includes('Tutor explanation of')), 'AI reply mirrored');
  // Mapping persisted for both mirrored messages.
  const byName = d.store._internal.messageMap;
  assert.ok([...byName.values()].filter((m) => m.direction === 'student').length === 1);
  assert.ok([...byName.values()].filter((m) => m.direction === 'ai').length === 1);
});

test('returning student GREEN chat: AI answers directly, conversation stored', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  await runStudentMessage(d, { message: { text: 'how are you today?' } });
  assert.ok(textsTo(d.telegram, 555000111).some((t) => t.includes('AI chat reply to: how are you today?')));
  const hist = await d.store.getConversation('555000111', 5);
  assert.ok(hist.some((h) => h.role === 'user' && h.content === 'how are you today?'));
  assert.ok(hist.some((h) => h.role === 'assistant'));
});

test('ORANGE: empathetic ack, no AI essay, inbox status update', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  const { result } = await runStudentMessage(d, { message: { text: 'I feel so depressed about my family situation' } });
  assert.equal(result.route, 'orange');
  const toStudent = textsTo(d.telegram, 555000111);
  assert.ok(toStudent.some((t) => t.includes('Florryshine know')), 'ack sent');
  assert.ok(!toStudent.some((t) => t.startsWith('AI chat reply')), 'no generic AI answer');
  const toAdmin = textsTo(d.telegram, ADMIN_GROUP_ID);
  assert.ok(toAdmin.some((t) => t.includes('Awaiting Florry')), 'status note in inbox');
});

test('RED: immediate safety guidance incl. 112 + urgent admin alert; never "wait for Florry"', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  const { result } = await runStudentMessage(d, { message: { text: 'I want to kill myself' } });
  assert.equal(result.route, 'red');
  const toStudent = textsTo(d.telegram, 555000111).join(' ');
  assert.ok(toStudent.includes('112'), 'emergency number given immediately');
  assert.ok(!/wait for Florry/i.test(toStudent), 'never told to just wait');
  const toAdmin = textsTo(d.telegram, ADMIN_GROUP_ID).join(' ');
  assert.ok(toAdmin.includes('URGENT SAFETY ALERT'), 'urgent alert posted');
});

test('PHASE 6: Florry replies to the mirrored STUDENT message → reaches exactly that student', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  await runStudentMessage(d, { message: { text: 'who is the first president of Nigeria?', update_id: 1 } });
  // Find the mirrored student message id in the admin group.
  const mirrored = d.telegram.calls.find((c) => c.method === 'sendMessage' && String(c.args.chat_id) === ADMIN_GROUP_ID && String(c.args.text).includes('who is the first president'));
  assert.ok(mirrored, 'student message mirrored with id');

  const replyUpdate = adminGroupMessage({
    message: { message_id: 800, text: 'Nnamdi Azikiwe was the first president!', reply_to_message: { message_id: mirrored.messageId, text: '...' } },
  });
  const result = await handleUpdate(replyUpdate, d.deps);
  assert.equal(result.route, 'admin_reply');
  assert.equal(result.studentChatId, '555000111');
  const delivered = textsTo(d.telegram, 555000111);
  assert.ok(delivered.some((t) => t.includes('Coach Florryshine') && t.includes('Nnamdi Azikiwe')));
});

test('PHASE 6: Florry replies to an AI RESPONSE → also reaches the student', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  await runStudentMessage(d, { message: { text: 'hello' } });
  const aiMirror = d.telegram.calls.find((c) => String(c.args.chat_id) === ADMIN_GROUP_ID && String(c.args.text || '').includes('AI chat reply to: hello'));
  assert.ok(aiMirror, 'AI reply mirrored');
  const result = await handleUpdate(adminGroupMessage({
    message: { message_id: 801, text: 'great answer, keep going!', reply_to_message: { message_id: aiMirror.messageId } },
  }), d.deps);
  assert.equal(result.route, 'admin_reply');
  assert.ok(textsTo(d.telegram, 555000111).some((t) => t.includes('great answer, keep going!')));
});

test('PHASE 6 SAFETY: reply to an unmapped message never sends to a guessed student', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  const before = textsTo(d.telegram, 555000111).length;
  const result = await handleUpdate(adminGroupMessage({
    message: { message_id: 802, text: 'some random reply', reply_to_message: { message_id: 999999 } },
  }), d.deps);
  assert.equal(result.route, 'reply_unmapped');
  assert.equal(textsTo(d.telegram, 555000111).length, before, 'student received nothing');
});

test('PHASE 9 #20 SAFETY: two students — reply to A NEVER reaches B', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  await d.sheets.addNewStudent('666000222', 'Bola');
  await runStudentMessage(d, { message: { text: 'message from Ada', from: { id: 555000111, first_name: 'Ada', is_bot: false }, chat: { id: 555000111, type: 'private' } } });
  await runStudentMessage(d, { message: { text: 'message from Bola', from: { id: 666000222, first_name: 'Bola', is_bot: false }, chat: { id: 666000222, type: 'private' } } });

  const adaMirror = d.telegram.calls.find((c) => String(c.args.chat_id) === ADMIN_GROUP_ID && String(c.args.text).includes('message from Ada'));
  await handleUpdate(adminGroupMessage({
    message: { message_id: 810, text: 'this is for Ada only', reply_to_message: { message_id: adaMirror.messageId } },
  }), d.deps);

  const toAda = textsTo(d.telegram, 555000111);
  const toBola = textsTo(d.telegram, 666000222);
  assert.ok(toAda.some((t) => t.includes('this is for Ada only')), 'Ada got her reply');
  assert.ok(!toBola.some((t) => t.includes('this is for Ada only')), 'Bola never saw it');
});

test('unauthorized admin command attempt is rejected (allow-list enforced)', async () => {
  const d = makeDeps();
  let broadcastStarted = false;
  d.deps.broadcast.handleMessage = async () => { broadcastStarted = true; return true; };
  const result = await handleUpdate(adminGroupMessage({
    message: { text: '/broadcast spam everyone', from: { id: 999, first_name: 'Stranger', is_bot: false } },
  }), d.deps);
  assert.equal(result.route, 'unauthorized');
  assert.equal(broadcastStarted, false, 'broadcast engine never invoked');
});

test('commands tolerate suffixes: /help@ShineBot works', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  await runStudentMessage(d, { message: { text: '/help@Coachflorryshinebot' } });
  assert.ok(textsTo(d.telegram, 555000111).some((t) => t.includes('Shine Bot Commands')));
});

test('student voice note without text: mirrored as media + acknowledged', async () => {
  const d = makeDeps();
  await d.sheets.addNewStudent('555000111', 'Ada');
  const { result } = await runStudentMessage(d, { message: { text: null, voice: { file_id: 'FID1', duration: 5 } } });
  assert.equal(result.route, 'media_forward');
  assert.ok(d.telegram.calls.some((c) => c.method === 'sendSameMedia' && String(c.args.chat_id) === ADMIN_GROUP_ID));
  assert.ok(textsTo(d.telegram, 555000111).some((t) => t.includes('voice note')));
  const map = [...d.store._internal.messageMap.values()].find((m) => m.direction === 'student');
  assert.equal(map.messageType, 'voice');
});

test('HTTP layer: missing/incorrect webhook secret → 401 (no processing)', async () => {
  const d = makeDeps();
  const res = makeRes();
  const update = privateMessage({ message: { text: 'hello' } });
  await processRequest({ method: 'POST', headers: {}, body: update }, res, async () => d.deps);
  assert.equal(res.code, 401);
  assert.equal(d.telegram.calls.length, 0, 'nothing processed');
});

test('HTTP layer: valid secret processes; duplicate update_id → duplicate:true and no double reply', async () => {
  const d = makeDeps();
  const update = privateMessage({ message: { text: 'who is Bola Ige?' }, update_id: 424242 });
  const headers = { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' };

  const res1 = makeRes();
  await processRequest({ method: 'POST', headers, body: update }, res1, async () => d.deps);
  assert.equal(res1.code, 200);
  assert.equal(res1.body.ok, true);
  const repliesAfterFirst = d.telegram.calls.length;

  const res2 = makeRes();
  await processRequest({ method: 'POST', headers, body: update }, res2, async () => d.deps);
  assert.equal(res2.body.duplicate, true);
  assert.equal(d.telegram.calls.length, repliesAfterFirst, 'no additional sends on duplicate');
});

test('HTTP layer: handler exception still returns 200 (no Telegram retry storm)', async () => {
  const d = makeDeps();
  d.deps.classify = async () => { throw new Error('kaboom'); };
  const res = makeRes();
  await processRequest({
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret' },
    body: privateMessage({ message: { text: 'hello' } }),
  }, res, async () => d.deps);
  assert.equal(res.code, 200);
  assert.equal(res.body.ok, false);
});
