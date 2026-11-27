// tests/googleSheets.test.mjs — Phase 7: header-driven schema, telegram id
// normalisation, real updateLastMessageSent, eligibility rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.GOOGLE_SHEET_ID = 'test-sheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({ client_email: 't@t', private_key: 'k' });

const sheets = await import('../lib/googleSheets.js');

function makeFakeSheetsClient({ headerRow, rows }) {
  const calls = { get: [], update: [], append: [] };
  const client = {
    spreadsheets: {
      values: {
        get: async ({ range }) => {
          calls.get.push(range);
          if (range.startsWith('students!A1:U1')) return { data: { values: headerRow ? [headerRow] : [] } };
          return { data: { values: rows.map((r) => [...r]) } };
        },
        update: async ({ range, requestBody }) => {
          calls.update.push({ range, value: requestBody.values[0][0] });
          return {};
        },
        append: async ({ requestBody }) => {
          calls.append.push(requestBody.values[0]);
          return {};
        },
      },
    },
  };
  client._calls = calls;
  return client;
}

const FULL_HEADER = ['userid', 'name', 'stage', 'exam', 'weak_subjects', 'target_scores', 'skills', 'availability', 'streak', 'last_active', 'joined_date', 'student_id', 'telegram_id', 'exam_date', 'confidence', 'skill_progress', 'status', 'goals', 'last_message_sent'];

test('getStudents: header-driven mapping regardless of column order', async () => {
  // Deliberately shuffled order: telegram_id FIRST.
  const header = ['telegram_id', 'name', 'status'];
  const rows = [[' 555000111.0 ', 'Ada', 'active'], ['5.12345678901e+11', 'Bola', 'silent']];
  const client = makeFakeSheetsClient({ headerRow: header, rows });
  sheets._setSheetsClientForTests(client);
  const students = await sheets.getStudents();
  assert.equal(students.length, 2);
  assert.equal(students[0].telegram_id, '555000111'); // whitespace + ".0" stripped
  assert.equal(students[1].telegram_id, '512345678901'); // scientific notation fixed
  assert.equal(students[1].status, 'silent');
  assert.equal(students[0].exam, ''); // missing column → empty, not crash
});

test('getStudents: legacy fixed layout when no header row exists', async () => {
  const client = makeFakeSheetsClient({ headerRow: null, rows: [[
    '', 'Ada', 'Active', 'JAMB', 'Physics', '280', ' debating', 'wknds', '3',
    '2026-11-01', '2026-10-01', 'S-01', '555000111', '2027-04-01', '6', '40%', 'active', 'med school', '',
  ]] });
  sheets._setSheetsClientForTests(client);
  const students = await sheets.getStudents();
  assert.equal(students.length, 1);
  assert.equal(students[0].name, 'Ada');
  assert.equal(students[0].telegram_id, '555000111');
  assert.equal(students[0].weak_subjects, 'Physics');
});

test('addNewStudent: writes every canonical field in header order', async () => {
  const client = makeFakeSheetsClient({ headerRow: FULL_HEADER, rows: [] });
  sheets._setSheetsClientForTests(client);
  const ok = await sheets.addNewStudent('555000999', 'Newbie');
  assert.equal(ok, true);
  assert.equal(client._calls.append.length, 1);
  const row = client._calls.append[0];
  assert.equal(row[FULL_HEADER.indexOf('telegram_id')], '555000999');
  assert.equal(row[FULL_HEADER.indexOf('name')], 'Newbie');
  assert.equal(row[FULL_HEADER.indexOf('status')], 'active');
  assert.ok(row[FULL_HEADER.indexOf('joined_date')]); // date filled
});

test('AUDIT Q10: updateLastMessageSent performs a REAL values.update', async () => {
  const client = makeFakeSheetsClient({ headerRow: FULL_HEADER, rows: [FULL_HEADER.map(() => '')] });
  sheets._setSheetsClientForTests(client);
  const ok = await sheets.updateLastMessageSent(2, '2026-11-23');
  assert.equal(ok, true);
  assert.equal(client._calls.update.length, 1);
  assert.equal(client._calls.update[0].range, 'students!S2');
  assert.equal(client._calls.update[0].value, '2026-11-23');
});

test('updateStudentField: warns (no write) when column is missing', async () => {
  const client = makeFakeSheetsClient({ headerRow: ['name', 'telegram_id'], rows: [['Ada', '1']] });
  sheets._setSheetsClientForTests(client);
  const ok = await sheets.updateStudentField(2, 'last_message_sent', 'x');
  assert.equal(ok, false);
  assert.equal(client._calls.update.length, 0);
});

test('eligibility rules', () => {
  const mk = (status, tid = '123') => ({ status, telegram_id: tid });
  assert.equal(sheets.isEligibleForBroadcast(mk('active')), true);
  assert.equal(sheets.isEligibleForBroadcast(mk('silent')), false);
  assert.equal(sheets.isEligibleForBroadcast(mk('inactive')), false);
  assert.equal(sheets.isEligibleForBroadcast(mk('active', '')), false);
  assert.equal(sheets.isEligibleForDaily(mk('silent')), false);
  assert.equal(sheets.isEligibleForDaily(mk('inactive')), true); // v1 behaviour preserved
});
