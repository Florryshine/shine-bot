// tests/store.test.mjs — memory store + Sheets-backed store (fake sheets API).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.STORE_TYPE = 'memory';

const { makeMemoryStore } = await import('../lib/store/memoryStore.js');
const { makeSheetsStore } = await import('../lib/store/sheetsStore.js');

function mappingFixture(extra = {}) {
  return {
    adminGroupId: '-100999',
    adminMessageId: 1234,
    studentChatId: '555000111',
    studentMessageId: '501',
    conversationId: 'conv_555000111',
    direction: 'student',
    messageType: 'text',
    snippet: 'hello there',
    ...extra,
  };
}

test('memory store: message mapping roundtrip', async () => {
  const s = makeMemoryStore();
  await s.saveMessageMapping(mappingFixture());
  const found = await s.findMessageMapping({ adminGroupId: '-100999', adminMessageId: 1234 });
  assert.ok(found);
  assert.equal(String(found.studentChatId), '555000111');
  assert.equal(await s.findMessageMapping({ adminGroupId: '-100999', adminMessageId: 999999 }), null);
});

test('memory store: conversations + dedup + command state', async () => {
  const s = makeMemoryStore();
  for (let i = 0; i < 5; i++) {
    await s.appendConversation('555', 'conv_555', i % 2 ? 'assistant' : 'user', `msg ${i}`);
  }
  const hist = await s.getConversation('555', 3);
  assert.deepEqual(hist.map((h) => h.content), ['msg 2', 'msg 3', 'msg 4']);

  await s.markUpdateProcessed(42);
  assert.equal(await s.isUpdateProcessed(42), true);
  assert.equal(await s.isUpdateProcessed(43), false);

  await s.setCommandState('111', { flow: 'broadcast', phase: 'confirm' });
  assert.equal((await s.getCommandState('111')).phase, 'confirm');
  await s.clearCommandState('111');
  assert.equal(await s.getCommandState('111'), null);
});

test('memory store: broadcast records and history', async () => {
  const s = makeMemoryStore();
  await s.saveBroadcastRecord({ broadcastId: 'bc_1', adminUserId: '111', contentType: 'text', preview: 'hi', totalTargets: 3, sent: 0, failed: 0, status: 'delivering' });
  await s.appendBroadcastDelivery('bc_1', { studentName: 'Ada', studentChatId: '555', status: 'sent', telegramMessageId: 'x' });
  await s.updateBroadcastRecord('bc_1', { sent: 1, status: 'completed' });
  const hist = await s.getBroadcastHistory(5);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].sent, 1);
  assert.equal(hist[0].status, 'completed');
});

// ---- Fake Google Sheets API (just enough for the store) ----
function makeFakeSheetsApi() {
  const tabs = new Map(); // name -> rows (row 0 = header)
  const meta = {
    data: {
      sheets: [], // filled lazily from tabs
    },
  };
  const syncMeta = () => {
    meta.data.sheets = [...tabs.keys()].map((title, i) => ({ properties: { title, sheetId: i + 1 } }));
  };
  const parseRange = (range) => {
    const m = /^([^!]+)!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(range);
    if (!m) throw new Error(`bad range ${range}`);
    return { tab: m[1], colStart: m[2], rowStart: parseInt(m[3] || '1', 10) };
  };
  const colIndex = (letters) => letters.split('').reduce((acc, c) => acc * 26 + (c.charCodeAt(0) - 64), 0) - 1;
  const api = {
    spreadsheets: {
      get: async () => {
        syncMeta();
        return meta;
      },
      batchUpdate: async ({ requestBody }) => {
        const req = requestBody.requests[0];
        if (req.addSheet) {
          const title = req.addSheet.properties.title;
          if (tabs.has(title)) throw new Error(`already exists`);
          tabs.set(title, []);
        }
        if (req.deleteDimension) {
          const { startIndex, endIndex } = req.deleteDimension.range;
          const first = [...tabs.keys()][0];
          const rows = [...tabs.values()][0];
          void first;
          rows.splice(startIndex - 1, endIndex - startIndex);
        }
        return {};
      },
      values: {
        append: async ({ range, requestBody }) => {
          const { tab } = parseRange(range);
          if (!tabs.has(tab)) tabs.set(tab, []);
          tabs.get(tab).push(...requestBody.values);
          return {};
        },
        update: async ({ range, requestBody }) => {
          const { tab, rowStart, colStart } = parseRange(range);
          if (!tabs.has(tab)) tabs.set(tab, []);
          const rows = tabs.get(tab);
          const c = colIndex(colStart);
          requestBody.values.forEach((vals, i) => {
            const r = rowStart - 1 + i;
            while (rows.length <= r) rows.push([]);
            vals.forEach((v, j) => {
              rows[r][c + j] = String(v);
            });
          });
          return {};
        },
        get: async ({ range }) => {
          const { tab, rowStart } = parseRange(range);
          const rows = tabs.get(tab) || [];
          const sliced = rows.slice(rowStart - 1).map((r) => [...r]);
          return { data: { values: sliced.length ? sliced : undefined } };
        },
      },
    },
  };
  api._tabs = tabs;
  return api;
}

test('sheets store: mappings survive across instances (persisted rows)', async () => {
  const api = makeFakeSheetsApi();
  const store1 = makeSheetsStore({ sheetsLike: api });
  await store1.saveMessageMapping(mappingFixture({ adminMessageId: 777 }));
  const store2 = makeSheetsStore({ sheetsLike: api }); // "another lambda instance"
  const found = await store2.findMessageMapping({ adminGroupId: '-100999', adminMessageId: 777 });
  assert.ok(found, 'mapping should be found by a fresh instance');
  assert.equal(String(found.student_chat_id), '555000111');
});

test('sheets store: newest mapping wins for a re-sent admin message id', async () => {
  const api = makeFakeSheetsApi();
  const s = makeSheetsStore({ sheetsLike: api });
  await s.saveMessageMapping(mappingFixture({ adminMessageId: 800, studentChatId: '111' }));
  await s.saveMessageMapping(mappingFixture({ adminMessageId: 800, studentChatId: '222' }));
  const found = await s.findMessageMapping({ adminGroupId: '-100999', adminMessageId: 800 });
  assert.equal(String(found.student_chat_id), '222');
});

test('sheets store: conversation history returns latest N in order', async () => {
  const api = makeFakeSheetsApi();
  const s = makeSheetsStore({ sheetsLike: api });
  for (let i = 0; i < 6; i++) {
    await s.appendConversation('555', 'conv_555', i % 2 ? 'assistant' : 'user', `line ${i}`);
  }
  const hist = await s.getConversation('555', 4);
  assert.equal(hist.length, 4);
  assert.deepEqual(hist.map((h) => h.content), ['line 2', 'line 3', 'line 4', 'line 5']);
});

test('sheets store: update dedup + command state roundtrip', async () => {
  const api = makeFakeSheetsApi();
  const s = makeSheetsStore({ sheetsLike: api });
  await s.markUpdateProcessed(12345);
  assert.equal(await s.isUpdateProcessed(12345), true);
  assert.equal(await s.isUpdateProcessed(54321), false);
  await s.setCommandState('111', { flow: 'broadcast', phase: 'confirm', draft: { contentType: 'text' } });
  const st = await s.getCommandState('111');
  assert.equal(st.phase, 'confirm');
  assert.equal(st.draft.contentType, 'text');
});

test('sheets store: broadcast report rows update in place', async () => {
  const api = makeFakeSheetsApi();
  const s = makeSheetsStore({ sheetsLike: api });
  await s.saveBroadcastRecord({ broadcastId: 'bc_9', adminUserId: '111', contentType: 'voice', preview: 'vm', totalTargets: 2, sent: 0, failed: 0, status: 'delivering' });
  await s.updateBroadcastRecord('bc_9', { sent: 2, failed: 0, status: 'completed', completedAt: '2026-11-23T09:00:00Z' });
  const hist = await s.getBroadcastHistory(1);
  assert.equal(hist[0].sent, '2');
  assert.equal(hist[0].status, 'completed');
});
