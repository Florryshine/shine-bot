// lib/store/sheetsStore.js — Google-Sheets-backed persistent store.
//
// Audit conclusion (see AUDIT_REPORT.md Q10): Sheets is acceptable for this
// workload at academy scale (< ~100 students, tens of messages/day) provided
// (a) mapping rows are pruned on a retention schedule, (b) lookups are exact
// string matches on dedicated bot_* tabs that never mix with student records.
// When volume grows, set UPSTASH_REDIS_REST_URL/TOKEN and the same interface
// is served by redisStore.js — no code changes elsewhere.

import config from '../config.js';
import logger from '../logger.js';

const TABS = {
  messageMap: {
    name: 'bot_message_map',
    headers: ['created_at', 'admin_group_id', 'admin_message_id', 'student_chat_id', 'student_message_id', 'conversation_id', 'direction', 'message_type', 'snippet'],
  },
  conversations: {
    name: 'bot_conversations',
    headers: ['created_at', 'student_chat_id', 'conversation_id', 'role', 'content'],
  },
  updates: {
    name: 'bot_updates',
    headers: ['update_id', 'processed_at'],
  },
  commandState: {
    name: 'bot_command_state',
    headers: ['user_id', 'state_json', 'updated_at'],
  },
  broadcasts: {
    name: 'bot_broadcasts',
    headers: ['broadcast_id', 'created_at', 'admin_user_id', 'content_type', 'preview', 'total_targets', 'sent', 'failed', 'status', 'completed_at'],
  },
  broadcastLog: {
    name: 'bot_broadcast_log',
    headers: ['broadcast_id', 'student_name', 'student_chat_id', 'status', 'error', 'telegram_message_id', 'sent_at'],
  },
};

const PRUNE_SAMPLE = 0.15; // fraction of writes that trigger retention pruning

function nowIso() {
  return new Date().toISOString();
}

function escapeSnippet(text, max = 500) {
  return String(text || '').replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

export function makeSheetsStore({ sheetsLike, spreadsheetId = config.googleSheetId, loggerLike = logger, retentionDays = config.mappingRetentionDays, conversationRetentionDays = config.conversationRetentionDays } = {}) {
  const ensured = new Set();

  async function ensureTab(tabKey) {
    const tab = TABS[tabKey];
    if (ensured.has(tab.name)) return;
    // Create the tab if missing, then write the header row.
    try {
      await sheetsLike.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab.name } } }] },
      });
    } catch (err) {
      if (!/already exists|duplicate/i.test(err.message || '')) {
        loggerLike.warn(`ensureTab(${tab.name}): ${err.message}`);
      }
    }
    await sheetsLike.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab.name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [tab.headers] },
    });
    ensured.add(tab.name);
  }

  async function appendRow(tabKey, values) {
    const tab = TABS[tabKey];
    await ensureTab(tabKey);
    await sheetsLike.spreadsheets.values.append({
      spreadsheetId,
      range: `${tab.name}!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
  }

  async function readTab(tabKey) {
    const tab = TABS[tabKey];
    await ensureTab(tabKey);
    const res = await sheetsLike.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab.name}!A2:Z`,
    });
    const rows = res.data.values || [];
    return rows.map((row) => {
      const obj = {};
      tab.headers.forEach((h, i) => {
        obj[h] = row[i] === undefined || row[i] === null ? '' : String(row[i]);
      });
      return obj;
    });
  }

  // Prune rows older than cutoffDays: data rows are appended chronologically,
  // so anything older than the cutoff is a contiguous block at the top.
  // NOTE: deleteDimension needs the numeric sheet id, not the tab name. We
  // resolve it lazily and cache.
  const sheetIdCache = new Map();
  async function resolveSheetId(tabName) {
    if (sheetIdCache.has(tabName)) return sheetIdCache.get(tabName);
    const meta = await sheetsLike.spreadsheets.get({ spreadsheetId });
    const found = (meta.data.sheets || []).find((s) => s.properties.title === tabName);
    if (!found) throw new Error(`tab ${tabName} not found`);
    const id = found.properties.sheetId;
    sheetIdCache.set(tabName, id);
    return id;
  }

  async function prune(tabKey, cutoffDays, timestampField = 'created_at') {
    try {
      const tab = TABS[tabKey];
      const res = await sheetsLike.spreadsheets.values.get({ spreadsheetId, range: `${tab.name}!A2:A` });
      const rows = res.data.values || [];
      const cutoff = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
      let stale = 0;
      for (const row of rows) {
        const t = Date.parse(row[0] || '');
        if (Number.isNaN(t) || t < cutoff) stale++;
        else break; // chronological append order
      }
      if (stale > 0) {
        const sheetId = await resolveSheetId(tab.name);
        await sheetsLike.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 1 + stale } } }] },
        });
        loggerLike.info(`pruned ${stale} rows older than ${cutoffDays}d from ${tab.name}`);
      }
    } catch (err) {
      loggerLike.warn(`prune(${TABS[tabKey].name}) skipped: ${err.message}`);
    }
  }

  function maybePrune(tabKey, cutoffDays) {
    if (Math.random() < PRUNE_SAMPLE) {
      prune(tabKey, cutoffDays).catch(() => {});
    }
  }

  // ---- Message mappings (Phase 4/6) ----
  async function saveMessageMapping(mapping) {
    await appendRow('messageMap', [
      nowIso(),
      String(mapping.adminGroupId),
      String(mapping.adminMessageId),
      String(mapping.studentChatId),
      String(mapping.studentMessageId || ''),
      mapping.conversationId || '',
      mapping.direction || 'student',
      mapping.messageType || 'text',
      escapeSnippet(mapping.snippet, 500),
    ]);
    maybePrune('messageMap', retentionDays);
  }

  async function findMessageMapping({ adminGroupId, adminMessageId }) {
    const rows = await readTab('messageMap');
    const g = String(adminGroupId);
    const m = String(adminMessageId);
    // Newest first: if a message was re-sent, the latest mapping wins.
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].admin_group_id === g && rows[i].admin_message_id === m) return rows[i];
    }
    return null;
  }

  // ---- Conversations ----
  async function appendConversation(studentChatId, conversationId, role, content) {
    await appendRow('conversations', [nowIso(), String(studentChatId), conversationId, role, escapeSnippet(content, 4000)]);
    maybePrune('conversations', conversationRetentionDays);
  }

  async function getConversation(studentChatId, limit = 12) {
    const rows = await readTab('conversations');
    const mine = rows.filter((r) => r.student_chat_id === String(studentChatId));
    return mine.slice(-limit).map((r) => ({ role: r.role, content: r.content }));
  }

  // ---- Update deduplication ----
  async function isUpdateProcessed(updateId) {
    const rows = await readTab('updates');
    return rows.some((r) => r.update_id === String(updateId));
  }

  async function markUpdateProcessed(updateId) {
    await appendRow('updates', [String(updateId), nowIso()]);
    if (Math.random() < PRUNE_SAMPLE) prune('updates', 7).catch(() => {});
  }

  // ---- Admin command state (broadcast drafts) ----
  async function getCommandState(userId) {
    const rows = await readTab('commandState');
    const row = rows.reverse().find((r) => r.user_id === String(userId));
    if (!row || !row.state_json) return null;
    try {
      return JSON.parse(row.state_json);
    } catch {
      return null;
    }
  }

  async function setCommandState(userId, state) {
    await appendRow('commandState', [String(userId), JSON.stringify(state), nowIso()]);
  }

  async function clearCommandState(userId) {
    await setCommandState(userId, { cleared: true, cleared_at: nowIso() });
  }

  // ---- Broadcast records ----
  async function saveBroadcastRecord(rec) {
    await appendRow('broadcasts', [
      rec.broadcastId, nowIso(), String(rec.adminUserId), rec.contentType, escapeSnippet(rec.preview, 300),
      rec.totalTargets, rec.sent, rec.failed, rec.status, rec.completedAt || '',
    ]);
  }

  async function updateBroadcastRecord(broadcastId, fields) {
    const tab = TABS.broadcasts;
    const res = await sheetsLike.spreadsheets.values.get({ spreadsheetId, range: `${tab.name}!A2:J` });
    const rows = res.data.values || [];
    const idx = rows.findIndex((r) => String(r[0]) === String(broadcastId));
    if (idx < 0) return;
    const row = rows[idx];
    const mapped = [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]];
    if (fields.sent !== undefined) mapped[6] = fields.sent;
    if (fields.failed !== undefined) mapped[7] = fields.failed;
    if (fields.status !== undefined) mapped[8] = fields.status;
    if (fields.completedAt !== undefined) mapped[9] = fields.completedAt;
    await sheetsLike.spreadsheets.values.update({
      spreadsheetId,
      range: `${tab.name}!A${idx + 2}:J${idx + 2}`,
      valueInputOption: 'RAW',
      requestBody: { values: [mapped] },
    });
  }

  async function getBroadcastHistory(limit = 5) {
    const rows = await readTab('broadcasts');
    return rows.slice(-limit).reverse();
  }

  async function appendBroadcastDelivery(broadcastId, delivery) {
    await appendRow('broadcastLog', [
      broadcastId, delivery.studentName || '', String(delivery.studentChatId || ''),
      delivery.status || 'unknown', escapeSnippet(delivery.error, 300),
      String(delivery.telegramMessageId || ''), delivery.sentAt || nowIso(),
    ]);
  }

  return {
    type: 'sheets',
    saveMessageMapping,
    findMessageMapping,
    appendConversation,
    getConversation,
    isUpdateProcessed,
    markUpdateProcessed,
    getCommandState,
    setCommandState,
    clearCommandState,
    saveBroadcastRecord,
    updateBroadcastRecord,
    getBroadcastHistory,
    appendBroadcastDelivery,
    _tabs: TABS,
  };
}

export default makeSheetsStore;
