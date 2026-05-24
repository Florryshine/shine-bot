import axios from 'axios';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function sendMessage(chatId, text, parseMode = 'HTML') {
  try {
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text,
      parse_mode: parseMode,
    });
    console.log(`✓ Message sent to ${chatId}`);
    return response.data;
  } catch (error) {
    console.error(`✗ Failed to send to ${chatId}:`, error.response?.data || error.message);
    throw error;
  }
}

export async function sendMessageWithButtons(chatId, text, buttons) {
  try {
    const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: text,
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error sending message with buttons:', error);
    throw error;
  }
}

export async function editMessage(chatId, messageId, text) {
  try {
    const response = await axios.post(`${TELEGRAM_API}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text: text,
    });
    return response.data;
  } catch (error) {
    console.error('Error editing message:', error);
    throw error;
  }
}

export async function answerCallbackQuery(callbackQueryId, text) {
  try {
    await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text: text,
    });
  } catch (error) {
    console.error('Error answering callback:', error);
  }
}

export async function setWebhook(url) {
  try {
    const response = await axios.post(`${TELEGRAM_API}/setWebhook`, {
      url: url,
    });
    console.log('Webhook set:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error setting webhook:', error);
    throw error;
  }
}

export async function getWebhookInfo() {
  try {
    const response = await axios.get(`${TELEGRAM_API}/getWebhookInfo`);
    return response.data;
  } catch (error) {
    console.error('Error getting webhook info:', error);
    throw error;
  }
}
