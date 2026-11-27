// lib/broadcast.js — Broadcast engine (Phase 5).
//
// Draft-and-confirm workflow from the existing admin group:
//   /broadcast            → bot asks for content
//   (admin sends text / voice / photo / document / video / forwarded msg)
//                         → bot previews it with CONFIRM / CANCEL buttons
//   /cancel (or button)   → aborts
//   CONFIRM               → delivers to eligible students, returns a report
//
// Ordinary admin-group chatter never triggers a broadcast: only the
// /broadcast command enters the state machine, and only for authorised admins.

import config from './config.js';
import logger from './logger.js';
import { makeTelegramClient } from './telegram/client.js';

function broadcastId() {
  return `bc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clip(text, max = 200) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// What kind of content is the draft? Returns {type, fileId?, text}
function describeContent(message) {
  if (message.voice) return { type: 'voice', fileId: message.voice.file_id, text: message.caption || '' };
  if (message.audio) return { type: 'audio', fileId: message.audio.file_id, text: message.caption || '' };
  if (message.photo) {
    const best = message.photo[message.photo.length - 1];
    return { type: 'photo', fileId: best.file_id, text: message.caption || '' };
  }
  if (message.video) return { type: 'video', fileId: message.video.file_id, text: message.caption || '' };
  if (message.document) return { type: 'document', fileId: message.document.file_id, text: message.caption || '' };
  if (message.text) return { type: 'text', text: message.text };
  return null;
}

export function makeBroadcastEngine({ store, telegram = makeTelegramClient(), sheetsModule, getStudentsFn, isEligibleFn } = {}) {
  // Lazy-deps default: real Google Sheets + Telegram client.
  async function students() {
    if (getStudentsFn) return getStudentsFn();
    const sheets = sheetsModule || (await import('./googleSheets.js')).default;
    return sheets.getStudents();
  }
  function eligible(student) {
    if (isEligibleFn) return isEligibleFn(student);
    return Boolean(student.telegram_id) && !['silent', 'inactive', 'left', 'blocked'].includes(student.status);
  }

  function previewText(draft) {
    const typeLabel = {
      text: '📝 Text', voice: '🎙️ Voice note', audio: '🎵 Audio', photo: '🖼️ Image',
      video: '🎬 Video', document: '📄 Document',
    }[draft.contentType] || '💬 Message';
    const body = draft.contentType === 'text' ? clip(draft.content, 400) : clip(draft.caption || '(media)', 200);
    return `${typeLabel} broadcast draft:\n\n${body}\n\n👥 Recipients: eligible registered students only.\n\nConfirm delivery?`;
  }

  const CONFIRM_BUTTONS = [[
    { text: '✅ CONFIRM', callback_data: 'bc_confirm' },
    { text: '❌ CANCEL', callback_data: 'bc_cancel' },
  ]];

  // ---- State machine steps ----

  // Step 1: /broadcast command. Any admin-group message afterwards that belongs
  // to this admin while a draft is open is treated as content.
  async function startBroadcast(adminUser, adminGroupId) {
    await store.setCommandState(adminUser.id, {
      flow: 'broadcast',
      phase: 'awaiting_content',
      adminGroupId: String(adminGroupId),
      startedAt: new Date().toISOString(),
    });
    await telegram.sendMessage(
      adminGroupId,
      `📢 <b>Broadcast mode started</b>\n\nSend me the message to broadcast — text, voice note, image, document or PDF (forwards work too).\n\nWhen you're ready I'll show you a preview to confirm.\n\nSend /cancel to abort.`
    );
    return { ok: true, phase: 'awaiting_content' };
  }

  // Step 2: content capture → preview.
  async function captureContent(adminMessage, adminUser) {
    const state = await store.getCommandState(adminUser.id);
    if (!state || state.flow !== 'broadcast' || state.phase !== 'awaiting_content') return null;

    const draft = describeContent(adminMessage);
    if (!draft) {
      await telegram.sendMessage(adminGroupIdOf(state), '⚠️ I couldn’t read that message type yet. Send text, voice, photo, video or a document.');
      return { ok: false };
    }

    const rec = {
      flow: 'broadcast',
      phase: 'confirm',
      adminGroupId: state.adminGroupId,
      draft: {
        contentType: draft.type,
        fileId: draft.fileId || '',
        caption: draft.text || '',
        content: draft.type === 'text' ? draft.text : '',
        previewSnippet: clip(draft.type === 'text' ? draft.text : `[${draft.type}] ${draft.text || ''}`, 300),
      },
      startedAt: state.startedAt,
    };
    await store.setCommandState(adminUser.id, rec);

    await telegram.sendWithButtons(adminGroupIdOf(state), previewText({
      contentType: draft.type,
      caption: draft.text,
      content: draft.text,
    }), CONFIRM_BUTTONS);
    return { ok: true, phase: 'confirm' };
  }

  function adminGroupIdOf(state) {
    return state.adminGroupId || config.adminGroupId;
  }

  // Step 3: confirmation button.
  async function handleBroadcastCallback(callbackQuery) {
    const data = callbackQuery.data;
    const adminUser = callbackQuery.from;
    const adminGroupId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const state = await store.getCommandState(adminUser.id);

    if (data === 'bc_cancel') {
      await store.clearCommandState(adminUser.id);
      await telegram.answerCallbackQuery(callbackQuery.id, 'Broadcast cancelled');
      if (messageId) await telegram.editMessage(adminGroupId, messageId, '❌ Broadcast cancelled — nothing was sent.');
      return { ok: true, action: 'cancelled' };
    }

    if (data === 'bc_confirm') {
      if (!state || state.flow !== 'broadcast' || state.phase !== 'confirm') {
        await telegram.answerCallbackQuery(callbackQuery.id, 'No pending broadcast draft');
        if (messageId) await telegram.editMessage(adminGroupId, messageId, '⚠️ No pending broadcast draft (already delivered or cancelled).');
        return { ok: true, action: 'noop' };
      }
      // Flip state first: a redelivered callback is a no-op (idempotent).
      await store.setCommandState(adminUser.id, { ...state, phase: 'delivering' });
      await telegram.answerCallbackQuery(callbackQuery.id, 'Delivering…');
      await telegram.editMessage(adminGroupId, messageId, '📤 Delivering broadcast…');
      const result = await deliver(state.draft, adminUser, state.adminGroupId);
      await store.clearCommandState(adminUser.id);
      return { ok: true, action: 'delivered', result };
    }

    return null;
  }

  // Step 4: delivery with rate-limit safety, retry, per-student tracking.
  async function deliver(draft, adminUser, adminGroupIdOverride) {
    const adminGroupId = adminGroupIdOverride || config.adminGroupId;
    const id = broadcastId();
    const list = (await students()).filter(eligible);
    const targets = list.slice(0, config.maxBroadcastBatch);
    const skipped = Math.max(0, list.length - targets.length);

    let sent = 0;
    let failed = 0;
    const failures = [];

    await store.saveBroadcastRecord({
      broadcastId: id,
      adminUserId: adminUser?.id || '',
      contentType: draft.contentType,
      preview: draft.previewSnippet || '',
      totalTargets: targets.length,
      sent: 0,
      failed: 0,
      status: 'delivering',
    });

    for (const student of targets) {
      try {
        let result;
        if (draft.contentType === 'text') {
          const wrapped = `📢 <b>Announcement — Shiney Brain Academy</b>\n\n${draft.content}\n\n━━━━━━━━━━━━━━━\nShine Bot 🤖`;
          result = await telegram.sendMessage(student.telegram_id, wrapped);
        } else {
          const cap = draft.caption ? `📢 <b>Announcement — Shiney Brain Academy</b>\n\n${draft.caption}` : '📢 Announcement — Shiney Brain Academy';
          if (draft.contentType === 'voice') result = await telegram.sendVoice(student.telegram_id, draft.fileId, cap);
          else if (draft.contentType === 'audio') result = await telegram.sendAudio(student.telegram_id, draft.fileId, cap);
          else if (draft.contentType === 'photo') result = await telegram.sendPhoto(student.telegram_id, draft.fileId, cap);
          else if (draft.contentType === 'video') result = await telegram.sendVideo(student.telegram_id, draft.fileId, cap);
          else result = await telegram.sendDocument(student.telegram_id, draft.fileId, cap);
        }
        sent++;
        await store.appendBroadcastDelivery(id, {
          studentName: student.name, studentChatId: student.telegram_id,
          status: 'sent', telegramMessageId: result?.message_id || '',
        });
      } catch (err) {
        failed++;
        const reason = err.permanent ? 'blocked/deactivated' : err.telegramDescription || err.message;
        failures.push({ name: student.name, chatId: student.telegram_id, reason });
        await store.appendBroadcastDelivery(id, {
          studentName: student.name, studentChatId: student.telegram_id,
          status: 'failed', error: String(reason).slice(0, 300),
        });
        if (err.permanent) continue; // no point retrying later sends after backoff
      }
      // ~12.5 msg/s — well under Telegram's global 30 msg/s and per-chat 1/s.
      await new Promise((r) => setTimeout(r, config.broadcastSendDelayMs));
    }

    const completedAt = new Date().toISOString();
    await store.updateBroadcastRecord(id, { sent, failed, status: 'completed', completedAt });

    const report = [
      `📊 <b>Broadcast report</b> (${id})`,
      ``,
      `✅ Delivered: ${sent}`,
      `❌ Failed: ${failed}`,
      skipped ? `⏭️ Skipped over batch cap: ${skipped}` : '',
      ``,
      failures.length ? `<b>Failure reasons:</b>\n${failures.slice(0, 15).map((f) => `• ${f.name} (${f.chatId}): ${f.reason}`).join('\n')}${failures.length > 15 ? `\n… and ${failures.length - 15} more` : ''}` : 'No failures 🎉',
    ].filter((l) => l !== '').join('\n');

    await telegram.sendMessage(adminGroupId, report);
    logger.info(`broadcast ${id}: sent=${sent} failed=${failed}`);
    return { broadcastId: id, sent, failed, failures };
  }

  // History: /broadcasthistory
  async function history(adminGroupId, limit = 5) {
    const recs = await store.getBroadcastHistory(limit);
    if (!recs.length) {
      await telegram.sendMessage(adminGroupId, '📭 No broadcasts yet.');
      return { ok: true };
    }
    const lines = recs.map((r) => {
      const when = (r.completedAt || r.created_at || '').replace('T', ' ').slice(0, 16);
      return `• <code>${r.broadcast_id || r.broadcastId || '?'}</code> — ${when} UTC — ✅${r.sent ?? r.sent ?? 0} / ❌${r.failed ?? 0} — ${clip(r.preview, 60)}`;
    });
    await telegram.sendMessage(adminGroupId, `📜 <b>Recent broadcasts</b>\n\n${lines.join('\n')}`);
    return { ok: true };
  }

  // Routes an admin-group message through the machine; returns true if consumed.
  async function handleMessage(message, adminUser, isAdmin) {
    if (!isAdmin) return false;
    const text = (message.text || '').trim();
    const state = await store.getCommandState(adminUser.id);

    if (text === '/broadcast' || text.startsWith('/broadcast ')) {
      if (state && (state.phase === 'awaiting_content' || state.phase === 'confirm')) {
        await telegram.sendMessage(message.chat.id, 'A broadcast draft is already open — send the content, or /cancel first.');
        return true;
      }
      await startBroadcast(adminUser, message.chat.id);
      if (text.length > '/broadcast '.length - 1) {
        // Convenience: /broadcast <text> creates the draft immediately.
        await captureContent({ text: text.replace(/^\/broadcast\s+/, '') }, adminUser);
      }
      return true;
    }

    if (text === '/cancel') {
      if (state && (state.phase === 'awaiting_content' || state.phase === 'confirm')) {
        await store.clearCommandState(adminUser.id);
        await telegram.sendMessage(message.chat.id, '❌ Broadcast draft cancelled. Nothing was sent.');
        return true;
      }
      return false; // let other handlers see /cancel
    }

    if (text === '/broadcasthistory') {
      await history(message.chat.id);
      return true;
    }

    // Content capture only while a draft is open for this admin.
    if (state && state.flow === 'broadcast' && state.phase === 'awaiting_content') {
      const res = await captureContent(message, adminUser);
      return res !== null;
    }

    return false;
  }

  return {
    startBroadcast,
    captureContent,
    handleBroadcastCallback,
    handleMessage,
    deliver,
    history,
    describeContent,
  };
}

export default makeBroadcastEngine;
