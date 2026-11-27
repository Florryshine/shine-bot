#!/usr/bin/env node
// scripts/repair-sheet.js — One-time repair of the `students` tab (run locally
// with real credentials; NEVER commit them):
//
//   GOOGLE_SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_CREDENTIALS='{"type":...}' node scripts/repair-sheet.js
//
// What it does:
//   1. Ensures every canonical header exists (appends missing ones at the
//      right edge — column order in the middle is left untouched).
//   2. Normalizes telegram_id values (Sheets number coercion: "5.123e+11",
//      trailing ".0", stray spaces) into clean text ids.
//   3. Defaults empty status cells to "active".
//   4. Reports duplicate / missing telegram ids without deleting anything.

import process from 'node:process';
import { google } from 'googleapis';

const STUDENT_HEADERS = [
  'userid', 'name', 'stage', 'exam', 'weak_subjects', 'target_scores', 'skills',
  'availability', 'streak', 'last_active', 'joined_date', 'student_id',
  'telegram_id', 'exam_date', 'confidence', 'skill_progress', 'status', 'goals',
  'last_message_sent',
];

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;
const CREDENTIALS = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS;
const TAB = process.env.STUDENTS_TAB || 'students';

if (!SPREADSHEET_ID || !CREDENTIALS) {
  console.error('Set GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_CREDENTIALS first. See UPGRADE_NOTES.md.');
  process.exit(1);
}

function colLetter(i) {
  let s = '';
  while (i >= 0) {
    s = String.fromCharCode((i % 26) + 65) + s;
    i = Math.floor(i / 26) - 1;
  }
  return s;
}

function normalizeId(raw) {
  if (raw === null || raw === undefined) return '';
  let s = String(raw).trim();
  if (/^\d+(\.\d+)?(e\+?\d+)?$/i.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.round(n));
  }
  return s.replace(/\.0$/, '');
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const tabMeta = (meta.data.sheets || []).find((s) => s.properties.title === TAB);
if (!tabMeta) {
  console.error(`Tab "${TAB}" not found. Tabs present: ${(meta.data.sheets || []).map((s) => s.properties.title).join(', ')}`);
  process.exit(1);
}

const head = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:Z1` });
const headerRow = (head.data.values || [])[0] || [];
const headerNorm = headerRow.map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));

const missing = STUDENT_HEADERS.filter((h) => !headerNorm.includes(h));
if (missing.length) {
  const startCol = headerRow.length;
  const values = [missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!${colLetter(startCol)}1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
  console.log(`✓ appended missing headers: ${missing.join(', ')}`);
  missing.forEach((h, i) => headerNorm[startCol + i] = h);
} else {
  console.log('✓ all canonical headers present');
}

const idx = {};
STUDENT_HEADERS.forEach((h) => {
  const i = headerNorm.indexOf(h);
  if (i >= 0) idx[h] = i;
});
const width = headerNorm.length;

const data = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:${colLetter(width - 1)}10000` });
const rows = data.data.values || [];

let idFixes = 0;
let statusFixes = 0;
const seen = new Map();
const problems = [];

const updates = [];
for (let r = 0; r < rows.length; r++) {
  const rowNumber = r + 2;
  const row = rows[r];
  const idCell = idx.telegram_id !== undefined ? (row[idx.telegram_id] || '') : '';
  const fixed = normalizeId(idCell);
  if (fixed !== idCell) {
    row[idx.telegram_id] = fixed;
    updates.push({ rowNumber, col: idx.telegram_id, value: fixed });
    idFixes++;
  }
  const statusCell = idx.status !== undefined ? String(row[idx.status] || '').trim().toLowerCase() : '';
  if (idx.status !== undefined && !statusCell) {
    row[idx.status] = 'active';
    updates.push({ rowNumber, col: idx.status, value: 'active' });
    statusFixes++;
  }
  const tid = idx.telegram_id !== undefined ? normalizeId(row[idx.telegram_id]) : '';
  if (tid) {
    if (seen.has(tid)) problems.push(`row ${rowNumber}: duplicate telegram_id ${tid} (first on row ${seen.get(tid)})`);
    else seen.set(tid, rowNumber);
  } else {
    problems.push(`row ${rowNumber}: empty telegram_id (name="${row[idx.name] || ''}")`);
  }
}

for (const u of updates) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!${colLetter(u.col)}${u.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[String(u.value)]] },
  });
}

console.log(`✓ normalized ${idFixes} telegram_id cell(s), defaulted ${statusFixes} empty status cell(s) to "active"`);
console.log(`✓ rows scanned: ${rows.length}, students with an id: ${seen.size}`);
if (problems.length) {
  console.log('⚠ issues (not auto-fixed):');
  problems.forEach((p) => console.log(`  - ${p}`));
} else {
  console.log('✓ no duplicate or missing telegram ids');
}
console.log('Done. If the tab was previously `Sheet1`, copy any remaining data into `students` and keep the header row.');
