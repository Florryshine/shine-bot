// pages/api/telegram/webhook.js — Shine Bot v2 orchestrator.
//
// Security (Phase 8): secret-token validation, update_id deduplication,
// at-most-once processing, always-200 responses (no Telegram retry storms),
// admin allow-list authorization, no secrets or PII in logs.
//
// Routing (Phase 3): GREEN → AI replies directly; ORANGE → empathetic ack +
// mentorship inbox; RED → immediate safety guidance + urgent alert.
//
// Inbox (Phase 4): every student message AND every AI reply is mirrored to the
// admin group with a persistent mapping (no text parsing).
//
// Admin reply (Phase 6): replies in the admin group resolve the student via the
// mapping store — replying to a student message or to an AI reply both work.
//
// Broadcast (Phase 5): handled by lib/broadcast.js (draft → confirm → deliver).

import appConfig from '../../../lib/config.js';
import logger from '../../../lib/logger.js';
import { getStore } from '../../../lib/store/index.js';
import { makeTelegramClient } from '../../../lib/telegram/client.js';
import { mirrorToAdminGroup, resolveReplyTarget, conversationIdFor, escapeHtml } from '../../../lib/inbox.js';
import { classifyMessage, generateEscalationAck } from '../../../lib/ai/classify.js';
import { generateAIReply } from '../../../lib/ai/chat.js';
import { generateTutorExplanation } from '../../../lib/ai/tutor.js';
import { generateShineMessage, generateWelcomeMessage } from '../../../lib/ai/motivation.js';
import { CRISIS_SAFETY_REPLY } from '../../../lib/ai/prompts.js';
import makeBroadcastEngine from '../../../lib/broadcast.js';

export const config = { maxDuration: 60 };

// ---------------------------------------------------------------------------
// Defaults (dependency wiring). Tests inject fakes via handleUpdate deps.
// ---------------------------------------------------------------------------
async function defaultDeps() {
  const [store, sheets] = await Promise.all([
    getStore(),
    import('../../../lib/googleSheets.js'),
  ]);
  const telegram = makeTelegramClient();
  const broadcast = makeBroadcastEngine({ store, telegram, sheetsModule: sheets.default });
  return { store, telegram, sheets: sheets.default, broadcast };
}

function isAdminUser(userId) {
  const id = appConfig.normalizeTelegramId(userId);
  if (appConfig.adminTelegramIds.length > 0) {
    return appConfig.adminTelegramIds.includes(id);
  }
  return null; // no allow-list configured: decide by group membership
}

function isCommand(message, name) {
  const text = String(message?.text || '').trim().toLowerCase();
  return text === `/${name}` || text.startsWith(`/${name} `) || text.startsWith(`/${name}@`);
}

// ---------------------------------------------------------------------------
// Student side
// ---------------------------------------------------------------------------
async function handleStudentPrivate(message, deps) {
  const { store, telegram, sheets } = deps;
  const chatId = appConfig.normalizeTelegramId(message.chat.id);
  const from = message.from || {};
  const firstName = from.first_name || 'there';
  const text = String(message.text || message.caption || '').trim();
  const media = message.voice || message.photo || message.video || message.audio || message.document;

  logger.student(chatId, firstName, text || '[media]');

  // Resolve student (or auto-register — v1 behaviour preserved).
  let student = await sheets.findStudentByTelegramId(chatId);
  let isNew = false;
  if (!student) {
    const registered = await sheets.addNewStudent(chatId, firstName);
    if (registered) {
      student = await sheets.findStudentByTelegramId(chatId);
      isNew = true;
    }
  }
  if (!student) {
    // Registration failed (Sheets down): keep serving the student without a profile.
    logger.error(`registration failed for ${chatId}; continuing without profile`);
    student = null;
  }

  const conversationId = conversationIdFor(chatId);

  // Welcome flow for genuinely new students (preserved), then CONTINUE with
  // this same message through the normal pipeline — v1 swallowed it, which is
  // why Florry never saw what a new student first said (audit Q8).
  if (isNew) {
    const welcome = await deps.welcome(firstName);
    await telegram.sendMessage(chatId, welcome);
    const helpText = `🎯 <b>Here's what I can do for you:</b>\n\n/today - Get today's study task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with me about anything\n/help - Show this menu\n\nOr just type any question and I'll answer! 💪`;
    await telegram.sendMessage(chatId, helpText);
    if (student) await sheets.touchStudent(student.row_number);
  }

  // ---- Media without text: mirror + acknowledge, no AI answer needed ----
  if (media && !text) {
    await mirrorToAdminGroup({
      store, telegram, adminGroupId: appConfig.adminGroupId, student, conversationId,
      kind: 'student', mediaMessage: message,
      studentMessageId: { chatId, messageId: message.message_id },
    });
    await telegram.sendMessage(chatId, `Got it! 📥 Florry can see your ${message.voice ? 'voice note 🎙️' : 'file'} in the mentorship inbox. If you also want to ask me something, just type it as a message.`);
    return { handled: true, route: 'media_forward' };
  }

  // ---- Commands (preserved from v1, tolerant of suffixes/arguments) ----
  if (isCommand(message, 'start')) {
    const msg = await generateShineMessage(student);
    await telegram.sendMessage(chatId, msg);
    await mirrorToAdminGroup({ store, telegram, adminGroupId: appConfig.adminGroupId, student, conversationId, kind: 'ai', classification: { category: 'green', topic: 'start_command' }, text: `[Bot /start reply] ${msg}`, studentMessageId: { chatId, messageId: message.message_id } });
    return { handled: true, route: 'command' };
  }
  if (isCommand(message, 'help')) {
    const helpText = `🎯 <b>Shine Bot Commands</b>\n\n/today - Get today's task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with Shine\n/help - Show this menu\n\nOr just type ANY question — I'll answer it! 💪`;
    await telegram.sendMessage(chatId, helpText);
    return { handled: true, route: 'command' };
  }
  if (isCommand(message, 'today')) {
    await telegram.sendMessage(chatId, 'Let me prepare your task for today... ⏳');
    const weak = escapeHtml(student?.weak_subjects || 'General Review');
    const taskMsg = `📋 <b>Today's Focus</b>\n\nLet's tackle your weak area (<b>${weak}</b>) for 30 minutes today. You've got this! 💪`;
    await telegram.sendMessage(chatId, taskMsg);
    return { handled: true, route: 'command' };
  }
  if (isCommand(message, 'progress')) {
    const name = escapeHtml(student?.name || 'champ');
    const progressMsg = `📊 <b>Your Progress</b>\n\nKeep pushing, ${name}! Every day of consistency compounds. You're doing great! 🚀`;
    await telegram.sendMessage(chatId, progressMsg);
    return { handled: true, route: 'command' };
  }
  if (isCommand(message, 'weak')) {
    const weak = escapeHtml(student?.weak_subjects || 'your challenges');
    const weakMsg = `💡 <b>Weak Subject Focus</b>\n\nLet's break down <b>${weak}</b> step by step. Which specific topic should we start with?`;
    await telegram.sendMessage(chatId, weakMsg);
    return { handled: true, route: 'command' };
  }

  if (!text) {
    return { handled: true, route: 'ignored_empty' };
  }

  // ---- Phase 3: intelligent routing ----
  const history = await store.getConversation(chatId, appConfig.conversationHistoryTurns);
  const recentContext = history.slice(-6).map((h) => `${h.role === 'assistant' ? 'Shine' : 'Student'}: ${h.content}`).join('\n');
  const classification = await deps.classify({ student, messageText: text, recentContext });
  logger.info(`route chat=${chatId} category=${classification.category} topic=${classification.topic} (${classification.source})`);

  // Mirror the student's message to the mentorship inbox (all categories).
  const mirrored = await mirrorToAdminGroup({
    store, telegram, adminGroupId: appConfig.adminGroupId, student, conversationId,
    kind: 'student', classification, text,
    studentMessageId: { chatId, messageId: message.message_id },
    urgency: classification.category === 'red',
  });

  await store.appendConversation(chatId, conversationId, 'user', text);
  if (student) await sheets.touchStudent(student.row_number);

  let reply = null;
  let route = classification.category;

  if (classification.category === 'red') {
    // Immediate safety guidance — never "wait for Florry" (Phase 3 rule).
    reply = CRISIS_SAFETY_REPLY;
    await telegram.sendMessage(chatId, reply);
    // Separate urgent ping so it surfaces even in a busy group.
    if (appConfig.adminGroupId) {
      await telegram.sendMessage(appConfig.adminGroupId, `🚨 <b>URGENT SAFETY ALERT</b> — student ${escapeHtml(student?.name || chatId)} (<code>${chatId}</code>) may be in immediate danger. Read their message above and follow up right away. Consider calling them or a guardian now.`);
    }
  } else if (classification.category === 'orange') {
    // Empathetic acknowledgement; Florry takes over from the inbox.
    const ack = await deps.escalationAck({ student, classification });
    reply = ack;
    await telegram.sendMessage(chatId, ack);
    if (appConfig.adminGroupId && mirrored) {
      await telegram.sendMessage(appConfig.adminGroupId, `🟠 <b>Awaiting Florry:</b> ${escapeHtml(student?.name || 'student')} shared something personal. Reply to their message above to respond.`);
    }
  } else {
    // GREEN: AI answers directly — tutor mode for academic asks, chat otherwise.
    if (classification.is_academic) {
      reply = await deps.tutorReply({ student, question: text, history });
    } else {
      reply = await deps.chatReply({ student, userMessage: text, history });
    }
    await telegram.sendMessage(chatId, reply);
    // Mirror the AI reply with its own mapping (Phase 6: reply-to-AI works).
    await mirrorToAdminGroup({
      store, telegram, adminGroupId: appConfig.adminGroupId, student, conversationId,
      kind: 'ai', classification, text: reply,
      studentMessageId: { chatId, messageId: message.message_id },
    });
    await store.appendConversation(chatId, conversationId, 'assistant', reply);
    if (student) await sheets.updateLastMessageSent(student.row_number, new Date().toISOString().split('T')[0]);
  }

  return { handled: true, route, category: classification.category };
}

// ---------------------------------------------------------------------------
// Admin side (private admin group)
// ---------------------------------------------------------------------------
async function handleAdminGroupMessage(message, deps) {
  const { store, telegram, broadcast } = deps;
  const adminGroupId = appConfig.normalizeTelegramId(message.chat.id);
  const from = message.from || {};
  const adminCheck = isAdminUser(from.id);

  // Authorization: allow-list wins; without one, membership of the private
  // admin group is trusted (config warning says so at startup).
  const isAdmin = adminCheck === null ? true : adminCheck;
  if (!isAdmin) {
    logger.warn(`unauthorized admin command attempt chat=${adminGroupId} user=${appConfig.normalizeTelegramId(from.id)}`);
    return { handled: true, route: 'unauthorized' };
  }

  // Phase 6: reply-to-student routing via the mapping store.
  if (message.reply_to_message) {
    const target = await resolveReplyTarget({
      store, adminGroupId, repliedToMessageId: message.reply_to_message.message_id,
    });
    if (!target) {
      // Not a mapped message: never guess the recipient (spec requirement).
      if (message.text && !message.text.startsWith('/')) {
        await telegram.sendMessage(adminGroupId, `⚠️ I don't have a student mapping for the message you replied to, so I can't route this reply. Reply directly to a mirrored student or Shine message.`);
      }
      return { handled: true, route: 'reply_unmapped' };
    }

    try {
      let sent;
      const header = `📩 <b>Coach Florryshine:</b>\n\n`;
      if (message.voice || message.audio || message.photo || message.video || message.document) {
        sent = await telegram.sendSameMedia(target.studentChatId, message, header + (message.caption || ''));
      } else {
        sent = await telegram.sendMessage(target.studentChatId, header + String(message.text || ''));
      }
      // Record the mentor reply in the conversation (labelled so the AI never
      // adopts Florry's voice as its own).
      await store.appendConversation(target.studentChatId, target.conversationId, 'user', `[Florryshine (mentor) replied]: ${String(message.text || message.caption || '[media]')}`);
      await telegram.sendMessage(adminGroupId, `✅ Delivered to student <code>${target.studentChatId}</code> (replying to their ${target.direction === 'ai' ? "Shine reply" : 'message'}): "${String(message.text || message.caption || '[media]').slice(0, 60)}"`);
      logger.info(`admin reply delivered chat=${target.studentChatId} tgMsgId=${sent?.message_id || ''}`);
      return { handled: true, route: 'admin_reply', studentChatId: target.studentChatId };
    } catch (err) {
      await telegram.sendMessage(adminGroupId, `❌ Could not deliver to student <code>${target.studentChatId}</code>: ${escapeHtml(err.message)}`);
      return { handled: true, route: 'admin_reply_failed' };
    }
  }

  // /id — discover your Telegram id to configure ADMIN_TELEGRAM_IDS.
  if (isCommand(message, 'id')) {
    await telegram.sendMessage(adminGroupId, `🪪 Your Telegram user id: <code>${appConfig.normalizeTelegramId(from.id)}</code>\n\nAdd it to ADMIN_TELEGRAM_IDS (comma-separated) to lock admin commands to specific people.`);
    return { handled: true, route: 'id_command' };
  }

  // Phase 5: broadcast engine (draft → confirm → deliver).
  const consumed = await broadcast.handleMessage(message, from, true);
  if (consumed) return { handled: true, route: 'broadcast' };

  // Ordinary group chatter: explicitly ignored (never broadcast accidentally).
  return { handled: false, route: 'group_noise' };
}

// ---------------------------------------------------------------------------
// Update router
// ---------------------------------------------------------------------------
export async function handleUpdate(update, deps) {
  // Injectable AI functions (tests provide fakes; production uses the real ones).
  deps = {
    classify: classifyMessage,
    chatReply: generateAIReply,
    tutorReply: generateTutorExplanation,
    escalationAck: generateEscalationAck,
    welcome: generateWelcomeMessage,
    ...deps,
  };
  const { store } = deps;

  if (update.callback_query) {
    const cq = update.callback_query;
    const adminCheck = cq.message && isAdminUser(cq.from.id);
    const isAdmin = adminCheck === null ? true : adminCheck;
    if (!isAdmin) return { handled: true, route: 'unauthorized_callback' };
    const result = await deps.broadcast.handleBroadcastCallback(cq);
    return { handled: true, route: result ? `callback_${result.action}` : 'callback_unknown' };
  }

  const message = update.message;
  if (!message) return { handled: false, route: 'no_message' };

  const chatType = message.chat?.type;
  if (chatType !== 'private') {
    if (appConfig.adminGroupId && appConfig.normalizeTelegramId(message.chat.id) === appConfig.adminGroupId) {
      return handleAdminGroupMessage(message, deps);
    }
    return { handled: false, route: 'other_group' };
  }

  // Ignore the bot's own messages.
  if (message.from?.is_bot) return { handled: false, route: 'bot_self' };

  return handleStudentPrivate(message, deps);
}

// ---------------------------------------------------------------------------
// HTTP handler (injectable for tests via processRequest)
// ---------------------------------------------------------------------------
export async function processRequest(req, res, depsProvider = defaultDeps) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Phase 8: webhook secret validation. Telegram sends the secret we registered
  // via setWebhook in the x-telegram-bot-api-secret-token header.
  if (appConfig.webhookSecret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== appConfig.webhookSecret) {
      logger.warn('webhook rejected: bad or missing secret token');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else if (appConfig.isProduction) {
    logger.warn('TELEGRAM_WEBHOOK_SECRET unset in production — webhook accepts any caller');
  }

  let update;
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Bad JSON' });
  }
  if (!update || typeof update !== 'object') {
    return res.status(200).json({ ok: true, skipped: 'empty' });
  }

  // Phase 8: update deduplication (Telegram retries on timeout/failure).
  const deps = await depsProvider();
  const updateId = update.update_id;
  try {
    if (updateId !== undefined && (await deps.store.isUpdateProcessed(updateId))) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    if (updateId !== undefined) await deps.store.markUpdateProcessed(updateId);
  } catch (err) {
    logger.error(`dedup check failed (continuing): ${err.message}`);
  }

  try {
    const result = await handleUpdate(update, deps);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    // Never 500 to Telegram: retries would duplicate side effects. Log loudly.
    logger.error(`update ${updateId} failed: ${error.message}`);
    return res.status(200).json({ ok: false, error: 'internal' });
  }
}

export default async function handler(req, res) {
  return processRequest(req, res, defaultDeps);
}
