// lib/telegram/client.js — Telegram Bot API client with rate-limit handling,
// retries and every send type the mentorship inbox needs (text, voice, photo,
// document, copy). Injectable axios-like layer for tests.

import axios from 'axios';
import config from '../config.js';
import logger from '../logger.js';

const SEND_RETRY_LIMIT = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

// apiCall: single Bot API method with 429 retry-after handling + backoff.
export async function apiCall(axiosLike, token, method, payload = {}, { maxRetries = SEND_RETRY_LIMIT } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await axiosLike.post(`https://api.telegram.org/bot${token}/${method}`, payload, {
        timeout: 20000,
        headers: { 'Content-Type': 'application/json' },
      });
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const body = err.response?.data;
      const retryAfter = body?.parameters?.retry_after;
      const description = body?.description || err.message;
      if (status === 403 && /blocked|deactivated|kicked/i.test(description)) {
        // Student blocked the bot or deactivated their account: permanent.
        const e = new Error(`permanent-failure: ${description}`);
        e.permanent = true;
        e.statusCode = 403;
        throw e;
      }
      if (attempt < maxRetries && (status === 429 || (retryAfter !== undefined) || isRetryable(status) || !status)) {
        const waitMs = retryAfter !== undefined ? (retryAfter + 1) * 1000 : Math.min(2000 * (attempt + 1), 8000);
        logger.warn(`Telegram ${method} failed (status=${status || 'network'}), retry ${attempt + 1}/${maxRetries} in ${waitMs}ms: ${description}`);
        await sleep(waitMs);
        continue;
      }
      const e = new Error(`Telegram ${method} failed: ${description}`);
      e.statusCode = status;
      e.telegramDescription = description;
      throw e;
    }
  }
  throw lastError;
}

export function makeTelegramClient({ token = config.telegramBotToken, axiosLike = axios } = {}) {
  const call = (method, payload, opts) => apiCall(axiosLike, token, method, payload, opts);

  async function sendMessage(chatId, text, extra = {}) {
    const data = await call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...extra,
    });
    return data.result;
  }

  async function sendWithButtons(chatId, text, buttons, extra = {}) {
    const data = await call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: buttons },
      ...extra,
    });
    return data.result;
  }

  async function editMessage(chatId, messageId, text, extra = {}) {
    const data = await call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      ...extra,
    });
    return data.result;
  }

  async function sendChatAction(chatId, action = 'typing') {
    try {
      await call('sendChatAction', { chat_id: chatId, action }, { maxRetries: 0 });
    } catch {
      /* non-critical */
    }
  }

  async function copyMessage(fromChatId, fromMessageId, toChatId, extra = {}) {
    const data = await call('copyMessage', {
      chat_id: toChatId,
      from_chat_id: fromChatId,
      message_id: fromMessageId,
      ...extra,
    });
    return data.result;
  }

  async function sendVoice(chatId, fileId, caption = '', extra = {}) {
    const data = await call('sendVoice', { chat_id: chatId, voice: fileId, caption, parse_mode: 'HTML', ...extra });
    return data.result;
  }

  async function sendPhoto(chatId, fileId, caption = '', extra = {}) {
    const data = await call('sendPhoto', { chat_id: chatId, photo: fileId, caption, parse_mode: 'HTML', ...extra });
    return data.result;
  }

  async function sendAudio(chatId, fileId, caption = '', extra = {}) {
    const data = await call('sendAudio', { chat_id: chatId, audio: fileId, caption, parse_mode: 'HTML', ...extra });
    return data.result;
  }

  async function sendVideo(chatId, fileId, caption = '', extra = {}) {
    const data = await call('sendVideo', { chat_id: chatId, video: fileId, caption, parse_mode: 'HTML', ...extra });
    return data.result;
  }

  async function sendDocument(chatId, fileId, caption = '', extra = {}) {
    const data = await call('sendDocument', { chat_id: chatId, document: fileId, caption, parse_mode: 'HTML', ...extra });
    return data.result;
  }

  async function answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    try {
      await call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert }, { maxRetries: 1 });
    } catch (e) {
      logger.warn(`answerCallbackQuery failed: ${e.message}`);
    }
  }

  async function setWebhook(url, secret, allowedUpdates) {
    const payload = { url, drop_pending_updates: true };
    if (secret) payload.secret_token = secret;
    if (allowedUpdates) payload.allowed_updates = allowedUpdates;
    return call('setWebhook', payload, { maxRetries: 1 });
  }

  async function getWebhookInfo() {
    return call('getWebhookInfo', {}, { maxRetries: 1 });
  }

  // Send whatever media a Telegram update message carries, reusing its file ids.
  // Returns the API result so callers can record the mapping.
  async function sendSameMedia(chatId, message, caption = '') {
    if (message.voice) return sendVoice(chatId, message.voice.file_id, caption);
    if (message.audio) return sendAudio(chatId, message.audio.file_id, caption);
    if (message.photo) {
      const best = message.photo[message.photo.length - 1];
      return sendPhoto(chatId, best.file_id, caption);
    }
    if (message.video) return sendVideo(chatId, message.video.file_id, caption);
    if (message.document) return sendDocument(chatId, message.document.file_id, caption);
    // Fallback: text (possibly empty).
    return sendMessage(chatId, caption || message.text || '');
  }

  return {
    tokenPresent: Boolean(token),
    sendMessage,
    sendWithButtons,
    editMessage,
    sendChatAction,
    copyMessage,
    sendVoice,
    sendAudio,
    sendVideo,
    sendPhoto,
    sendDocument,
    sendSameMedia,
    answerCallbackQuery,
    setWebhook,
    getWebhookInfo,
    raw: call,
  };
}

const defaultClient = makeTelegramClient();
export default defaultClient;
