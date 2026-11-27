// tests/helpers.mjs — shared fakes for the offline test suite.

// Fake Telegram client: records every call, returns sequential message ids.
export function makeFakeTelegram() {
  const calls = [];
  let nextMessageId = 1000;
  const record = (method, args) => {
    const id = nextMessageId++;
    calls.push({ method, args: args || {}, messageId: id });
    return Promise.resolve({ message_id: id, chat: { id: args?.chat_id } });
  };
  return {
    calls,
    sendMessage: (chatId, text, extra) => record('sendMessage', { chat_id: chatId, text, ...extra }),
    sendWithButtons: (chatId, text, buttons, extra) => record('sendWithButtons', { chat_id: chatId, text, buttons, ...extra }),
    editMessage: (chatId, messageId, text, extra) => record('editMessage', { chat_id: chatId, message_id: messageId, text, ...extra }),
    sendChatAction: async () => {},
    copyMessage: (from, fromId, to, extra) => record('copyMessage', { from, fromId, to, ...extra }),
    sendVoice: (chatId, fileId, caption, extra) => record('sendVoice', { chat_id: chatId, voice: fileId, caption, ...extra }),
    sendAudio: (chatId, fileId, caption, extra) => record('sendAudio', { chat_id: chatId, audio: fileId, caption, ...extra }),
    sendVideo: (chatId, fileId, caption, extra) => record('sendVideo', { chat_id: chatId, video: fileId, caption, ...extra }),
    sendPhoto: (chatId, fileId, caption, extra) => record('sendPhoto', { chat_id: chatId, photo: fileId, caption, ...extra }),
    sendDocument: (chatId, fileId, caption, extra) => record('sendDocument', { chat_id: chatId, document: fileId, caption, ...extra }),
    sendSameMedia: function (chatId, message, caption) {
      return record('sendSameMedia', { chat_id: chatId, kind: Object.keys(message || {}).find((k) => ['voice', 'photo', 'video', 'audio', 'document'].includes(k)) || 'text', caption });
    },
    answerCallbackQuery: async () => {},
    setWebhook: (url, secret) => record('setWebhook', { url, secret }),
    getWebhookInfo: async () => ({ ok: true, result: { url: '' } }),
    raw: record,
  };
}

// Fake AI: deterministic routing by content, records calls.
export function makeFakeAI() {
  const aiCalls = [];
  return {
    aiCalls,
    classify: async ({ messageText }) => {
      aiCalls.push(['classify', messageText]);
      const t = String(messageText).toLowerCase();
      if (/kill myself|suicide|want to die/.test(t)) return { category: 'red', topic: 'crisis_safety', is_academic: false, reason: 'crisis', source: 'test' };
      if (/sad|depressed|distress|family|sick|talk to florry/.test(t)) return { category: 'orange', topic: 'personal', is_academic: false, reason: 'personal', source: 'test' };
      if (/explain|photosynthesis|mitosis|jamb|chemistry|physics|biology/.test(t)) return { category: 'green', topic: 'academic', is_academic: true, reason: 'academic', source: 'test' };
      return { category: 'green', topic: 'chat', is_academic: false, reason: 'chat', source: 'test' };
    },
    chatReply: async ({ userMessage }) => {
      aiCalls.push(['chat', userMessage]);
      return `AI chat reply to: ${userMessage}`;
    },
    tutorReply: async ({ question }) => {
      aiCalls.push(['tutor', question]);
      return `Tutor explanation of: ${question}`;
    },
    escalationAck: async () => {
      aiCalls.push(['ack']);
      return 'I hear you, and I have let Florryshine know.';
    },
    welcome: async (name) => `Welcome, ${name}!`,
  };
}

// Fake Sheets for webhook tests: one in-memory student.
export function makeFakeSheets(students = []) {
  return {
    getStudents: async () => students,
    findStudentByTelegramId: async (id) => students.find((s) => String(s.telegram_id) === String(id)) || null,
    addNewStudent: async (telegramId, name) => {
      students.push({
        row_number: students.length + 2, name, telegram_id: String(telegramId),
        exam: 'JAMB', weak_subjects: 'Physics', status: 'active', confidence: 6,
      });
      return true;
    },
    updateLastMessageSent: async () => true,
    touchStudent: async () => true,
    updateStudentField: async () => true,
  };
}

export function makeRes() {
  const res = {
    code: 0,
    body: null,
    status(c) {
      res.code = c;
      return res;
    },
    json(o) {
      res.body = o;
      return res;
    },
  };
  return res;
}

export const ADMIN_GROUP_ID = '-100999';
export const FLORRY_ID = 111;
export function privateMessage(overrides = {}) {
  const { message: messageOverrides, ...rest } = overrides;
  return {
    message: {
      message_id: 501,
      chat: { id: 555000111, type: 'private' },
      from: { id: 555000111, first_name: 'TestStudent', is_bot: false },
      text: 'hello',
      ...messageOverrides,
    },
    update_id: Math.floor(Math.random() * 1e9),
    ...rest,
  };
}
export function adminGroupMessage(overrides = {}) {
  const { message: messageOverrides, ...rest } = overrides;
  return {
    message: {
      message_id: 700,
      chat: { id: Number(ADMIN_GROUP_ID), type: 'supergroup' },
      from: { id: FLORRY_ID, first_name: 'Florry', is_bot: false },
      text: 'ordinary chatter',
      ...messageOverrides,
    },
    update_id: Math.floor(Math.random() * 1e9),
    ...rest,
  };
}
