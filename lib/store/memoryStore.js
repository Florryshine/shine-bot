// lib/store/memoryStore.js — In-process store for local dev and tests.
// Data is lost when the serverless instance recycles; never rely on this in
// production (set STORE_TYPE=sheets or configure Upstash Redis).

export function makeMemoryStore() {
  const messageMap = new Map(); // `${groupId}:${messageId}` -> mapping
  const conversations = new Map(); // chatId -> [{role, content}]
  const processedUpdates = new Set();
  const commandState = new Map();
  const broadcasts = [];
  const broadcastLog = new Map(); // broadcastId -> [deliveries]

  return {
    type: 'memory',
    async saveMessageMapping(m) {
      messageMap.set(`${m.adminGroupId}:${m.adminMessageId}`, { ...m, created_at: new Date().toISOString() });
    },
    async findMessageMapping({ adminGroupId, adminMessageId }) {
      return messageMap.get(`${adminGroupId}:${adminMessageId}`) || null;
    },
    async appendConversation(studentChatId, conversationId, role, content) {
      const list = conversations.get(String(studentChatId)) || [];
      list.push({ role, content });
      conversations.set(String(studentChatId), list.slice(-50));
    },
    async getConversation(studentChatId, limit = 12) {
      const list = conversations.get(String(studentChatId)) || [];
      return list.slice(-limit).map((r) => ({ role: r.role, content: r.content }));
    },
    async isUpdateProcessed(updateId) {
      return processedUpdates.has(String(updateId));
    },
    async markUpdateProcessed(updateId) {
      processedUpdates.add(String(updateId));
    },
    async getCommandState(userId) {
      return commandState.get(String(userId)) || null;
    },
    async setCommandState(userId, state) {
      commandState.set(String(userId), state);
    },
    async clearCommandState(userId) {
      commandState.delete(String(userId));
    },
    async saveBroadcastRecord(rec) {
      broadcasts.push({ ...rec });
    },
    async updateBroadcastRecord(broadcastId, fields) {
      const rec = broadcasts.find((b) => b.broadcastId === broadcastId);
      if (rec) Object.assign(rec, fields);
    },
    async getBroadcastHistory(limit = 5) {
      return broadcasts.slice(-limit).reverse();
    },
    async appendBroadcastDelivery(broadcastId, delivery) {
      const list = broadcastLog.get(broadcastId) || [];
      list.push({ ...delivery, sentAt: delivery.sentAt || new Date().toISOString() });
      broadcastLog.set(broadcastId, list);
    },
    _internal: { messageMap, conversations, processedUpdates, commandState, broadcasts, broadcastLog },
  };
}

export default makeMemoryStore;
