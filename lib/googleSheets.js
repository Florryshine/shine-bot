// lib/googleSheets.js — Student records on Google Sheets (source of truth,
// preserved from v1). Repairs from the audit:
//   * header-driven column mapping — the sheet may reorder columns safely;
//   * one canonical schema for every caller (the old code had two different
//     layouts: lib/getStudents on tab `students` vs send-daily on tab `Sheet1`);
//   * updateLastMessageSent() now performs a real values.update (it was a stub
//     that only logged);
//   * telegram ids normalized against Sheets number coercion ("5.12e+11", ".0");
//   * eligibility helpers shared by broadcast and daily cron.

import { google } from 'googleapis';
import config from './config.js';
import logger from './logger.js';

const SPREADSHEET_ID = () => config.googleSheetId;
const STUDENTS_TAB = 'students';

// Canonical columns. ORDER MATTERS ONLY for the header row written by
// scripts/repair-sheet.js; reads/writes are resolved by header name.
export const STUDENT_HEADERS = [
  'userid',            // A — internal row id (empty ok)
  'name',              // B
  'stage',             // C
  'exam',              // D
  'weak_subjects',     // E
  'target_scores',     // F
  'skills',            // G
  'availability',      // H
  'streak',            // I
  'last_active',       // J
  'joined_date',       // K
  'student_id',        // L
  'telegram_id',       // M
  'exam_date',         // N
  'confidence',        // O
  'skill_progress',    // P
  'status',            // Q  (active | inactive | silent)
  'goals',             // R
  'last_message_sent', // S  (used by daily-cron bookkeeping)
];

let sheetsClient = null;

export async function getSheets() {
  if (sheetsClient) return sheetsClient;
  let credentials;
  try {
    credentials = JSON.parse(config.googleServiceAccountCredentials);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_CREDENTIALS is not valid JSON (see SECURITY.md)');
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

function normalizeTelegramId(raw) {
  return config.normalizeTelegramId(raw);
}

// Map a raw row (array of strings) to a student object using the header row.
function rowToStudent(headerIndex, row, rowNumber) {
  const get = (field) => {
    const idx = headerIndex[field];
    const v = idx === undefined ? '' : row[idx];
    return v === undefined || v === null ? '' : String(v);
  };
  return {
    row_number: rowNumber,
    name: get('name') || 'New Student',
    stage: get('stage'),
    exam: get('exam'),
    weak_subjects: get('weak_subjects'),
    target_scores: get('target_scores'),
    skills: get('skills'),
    availability: get('availability'),
    streak: get('streak') || '0',
    last_active: get('last_active'),
    joined_date: get('joined_date'),
    student_id: get('student_id'),
    telegram_id: normalizeTelegramId(get('telegram_id')),
    exam_date: get('exam_date'),
    confidence: parseInt(get('confidence'), 10) || 5,
    skill_progress: get('skill_progress') || '0%',
    status: (get('status') || 'active').trim().toLowerCase(),
    goals: get('goals'),
    last_message_sent: get('last_message_sent'),
  };
}

// Legacy fixed layout (v1 code): header row missing → assume the historical
// `students` tab order (name in B … telegram_id in M).
const LEGACY_INDEX = {
  userid: 0, name: 1, stage: 2, exam: 3, weak_subjects: 4, target_scores: 5,
  skills: 6, availability: 7, streak: 8, last_active: 9, joined_date: 10,
  student_id: 11, telegram_id: 12, exam_date: 13, confidence: 14,
  skill_progress: 15, status: 16, goals: 17, last_message_sent: 18,
};

async function readStudentsTable() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${STUDENTS_TAB}!A2:U1000`,
  });
  const rows = res.data.values || [];
  return { sheets, rows };
}

async function getHeaderIndex(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID(),
    range: `${STUDENTS_TAB}!A1:U1`,
  });
  const headerRow = (res.data.values || [])[0] || [];
  const index = {};
  const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, '_');
  STUDENT_HEADERS.forEach((field) => {
    const i = headerRow.findIndex((h) => norm(h) === field);
    if (i >= 0) index[field] = i;
  });
  // The essential fields must exist to trust the header mapping.
  if (index.telegram_id === undefined || index.name === undefined) return null;
  return index;
}

export async function getStudents() {
  try {
    const { sheets, rows } = await readStudentsTable();
    let headerIndex = null;
    try {
      headerIndex = await getHeaderIndex(sheets);
    } catch (err) {
      logger.warn(`header read failed, using legacy layout: ${err.message}`);
    }
    const idx = headerIndex || LEGACY_INDEX;
    return rows
      .map((row, i) => rowToStudent(idx, row, i + 2))
      .filter((s) => s.telegram_id);
  } catch (error) {
    logger.error(`getStudents failed: ${error.message}`);
    return [];
  }
}

export async function findStudentByTelegramId(telegramId) {
  const wanted = normalizeTelegramId(telegramId);
  if (!wanted) return null;
  const students = await getStudents();
  return students.find((s) => s.telegram_id === wanted) || null;
}

// Broadcast eligibility: registered, reachable, not opted out.
export function isEligibleForBroadcast(student) {
  return Boolean(student.telegram_id) && !['silent', 'inactive', 'left', 'blocked'].includes(student.status);
}

// Daily message eligibility (v1 behaviour: only 'silent' is excluded).
export function isEligibleForDaily(student) {
  return Boolean(student.telegram_id) && student.status !== 'silent';
}

// Test hook: inject a fake sheets client (unit tests only).
export function _setSheetsClientForTests(client) {
  sheetsClient = client;
}

export async function addNewStudent(telegramId, name, extra = {}) {
  try {
    const sheets = await getSheets();
    let headerIndex = null;
    try {
      headerIndex = await getHeaderIndex(sheets);
    } catch {
      headerIndex = null;
    }

    const student = {
      userid: '',
      name: name || 'New Student',
      stage: extra.stage || '',
      exam: extra.exam || '',
      weak_subjects: extra.weak_subjects || '',
      target_scores: extra.target_scores || '',
      skills: extra.skills || '',
      availability: extra.availability || '',
      streak: '0',
      last_active: new Date().toISOString().split('T')[0],
      joined_date: new Date().toISOString().split('T')[0],
      student_id: extra.student_id || '',
      telegram_id: normalizeTelegramId(telegramId),
      exam_date: extra.exam_date || '',
      confidence: String(extra.confidence ?? ''),
      skill_progress: extra.skill_progress || '0%',
      status: 'active',
      goals: extra.goals || '',
      last_message_sent: '',
    };

    if (headerIndex) {
      // Header-driven write: one row in canonical header order.
      const values = [STUDENT_HEADERS.map((h) => student[h] ?? '')];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID(),
        range: `${STUDENTS_TAB}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
    } else {
      // Legacy layout fallback (v1): A empty, B name, ..., M telegram_id.
      const values = [[
        '', student.name, student.stage || 'Active', student.exam, student.weak_subjects,
        student.target_scores, student.skills, student.availability, student.streak,
        student.last_active, student.joined_date, student.student_id, student.telegram_id,
        student.exam_date, student.confidence, student.skill_progress, student.status, student.goals,
      ]];
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID(),
        range: `${STUDENTS_TAB}!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      });
    }
    logger.info(`registered student chat=${student.telegram_id}`);
    return true;
  } catch (error) {
    logger.error(`addNewStudent failed: ${error.message}`);
    return false;
  }
}

// Generic single-field update by sheet row number (header-driven).
export async function updateStudentField(rowNumber, field, value) {
  try {
    const sheets = await getSheets();
    const headerIndex = await getHeaderIndex(sheets);
    const colIdx = headerIndex ? headerIndex[field] : LEGACY_INDEX[field];
    if (colIdx === undefined) {
      logger.warn(`updateStudentField: no column for "${field}" (run scripts/repair-sheet.js)`);
      return false;
    }
    const colLetter = String.fromCharCode(65 + colIdx); // A..U covers all fields
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID(),
      range: `${STUDENTS_TAB}!${colLetter}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[String(value)]] },
    });
    return true;
  } catch (error) {
    logger.error(`updateStudentField(${field}) failed: ${error.message}`);
    return false;
  }
}

// AUDIT FIX (Q10): this was a console.log stub that returned true without
// touching the sheet. Now it writes the real timestamp for the intended row.
export async function updateLastMessageSent(rowNumber, timestamp) {
  const ts = timestamp || new Date().toISOString().split('T')[0];
  return updateStudentField(rowNumber, 'last_message_sent', ts);
}

// Mark a student's last-active date (best effort, never throws).
export async function touchStudent(rowNumber) {
  return updateStudentField(rowNumber, 'last_active', new Date().toISOString().split('T')[0]);
}
