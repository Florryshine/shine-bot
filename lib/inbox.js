// lib/inbox.js — Florry's human mentorship inbox (Phase 4): mirror every
// student message and every bot reply into the private admin group, and store
// a persistent mapping so a reply in the group can be routed back to the exact
// student WITHOUT parsing message text (audit Q7 fix).
//
// Mapping fields per spec: admin group id, admin group message id, student
// chat id, student message id, conversation id, direction, message type,
// timestamp.

import config from './config.js';
import logger from './logger.js';
import { GREEN_ADMIN_TAG, ORANGE_ADMIN_TAG, CRISIS_ADMIN_ALERT_TAG } from './ai/prompts.js';

const TAGS = { green: GREEN_ADMIN_TAG, orange: ORANGE_ADMIN_TAG, red: CRISIS_ADMIN_ALERT_TAG };

export function conversationIdFor(chatId) {
  return `conv_${config.normalizeTelegramId(chatId)}`;
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function profileBlock(student) {
  if (!student) return '(new student — profile pending registration)';
  const bits = [
    student.exam && `Exam: ${student.exam}`,
    student.stage && `Stage: ${student.stage}`,
    student.weak_subjects && `Weak subjects: ${student.weak_subjects}`,
    student.target_scores && `Target: ${student.target_scores}`,
    student.exam_date && `Exam date: ${student.exam_date}`,
    student.confidence && `Confidence: ${student.confidence}/10`,
    student.status && `Status: ${student.status}`,
  ].filter(Boolean).join(' · ');
  return bits || '(no profile details yet)';
}

// Mirror a message into the admin group and persist its mapping.
// kind: 'student' | 'ai' | 'mentor_confirm'
export async function mirrorToAdminGroup({
  store, telegram, adminGroupId, student, studentMessageId, conversationId,
  kind = 'student', classification = null, text = '', mediaMessage = null, urgency = false,
}) {
  if (!adminGroupId) {
    logger.warn('ADMIN_GROUP_ID not set — message not mirrored to mentorship inbox');
    return null;
  }
  const chatId = config.normalizeTelegramId(student?.telegram_id || studentMessageId?.chatId || '');
  const tag = classification ? TAGS[classification.category] || '' : '';
  const statusLine = {
    student: 'New student message — reply directly to THIS message to answer',
    ai: 'Shine (AI) replied to the student — reply to THIS message to add/correct anything',
  }[kind] || '';

  const header = [
    tag,
    `👤 <b>From:</b> ${escapeHtml(student?.name || 'Unknown')} ${student?.student_id ? `(${escapeHtml(student.student_id)})` : ''}`,
    `🆔 <b>Student chat ID:</b> <code>${chatId}</code>`,
    classification ? `🏷️ <b>Classification:</b> ${classification.category.toUpperCase()} — ${escapeHtml(classification.topic)}${classification.reason ? ` (${escapeHtml(classification.reason)})` : ''}` : '',
    `🗂️ <b>Conversation:</b> <code>${conversationId}</code>`,
    `👤 <b>Profile:</b> ${escapeHtml(profileBlock(student))}`,
    `<b>━━━━━━━━━━━━━━━━━━</b>`,
  ].filter(Boolean).join('\n');

  let sent;
  try {
    if (mediaMessage) {
      const caption = `${header}\n\n${text ? `📝 ${escapeHtml(text)}\n` : ''}${statusLine ? `\n${statusLine}` : ''}`;
      sent = await telegram.sendSameMedia(adminGroupId, mediaMessage, caption);
    } else {
      const body = `${header}\n\n📝 <b>Message:</b>\n${escapeHtml(text)}\n\n${statusLine}`;
      sent = await telegram.sendMessage(adminGroupId, body);
    }
  } catch (err) {
    logger.error(`mirrorToAdminGroup failed: ${err.message}`);
    return null;
  }

  const adminMessageId = sent?.message_id;
  if (adminMessageId && chatId) {
    try {
      await store.saveMessageMapping({
        adminGroupId: config.normalizeTelegramId(adminGroupId),
        adminMessageId,
        studentChatId: chatId,
        studentMessageId: studentMessageId?.messageId || '',
        conversationId: conversationId || conversationIdFor(chatId),
        direction: kind,
        messageType: mediaMessage
          ? (mediaMessage.voice ? 'voice' : mediaMessage.photo ? 'photo' : mediaMessage.video ? 'video' : mediaMessage.audio ? 'audio' : 'document')
          : 'text',
        snippet: String(text || '').slice(0, 500),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error(`saveMessageMapping failed: ${err.message}`);
    }
  }
  return sent;
}

// Phase 6: resolve who an admin reply belongs to via the persistent mapping.
// Mapping rows come back snake_case from the Sheets store and camelCase from
// Redis/memory — normalise here so callers don't care.
export async function resolveReplyTarget({ store, adminGroupId, repliedToMessageId }) {
  if (!adminGroupId || !repliedToMessageId) return null;
  const mapping = await store.findMessageMapping({
    adminGroupId: config.normalizeTelegramId(adminGroupId),
    adminMessageId: repliedToMessageId,
  });
  if (!mapping) return null;
  return {
    studentChatId: mapping.student_chat_id ?? mapping.studentChatId,
    conversationId: mapping.conversation_id ?? mapping.conversationId,
    direction: mapping.direction || 'student',
    messageType: mapping.message_type ?? mapping.messageType,
    snippet: mapping.snippet || '',
    mapping,
  };
}
