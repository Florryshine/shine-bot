import { sendTelegramMessage } from '../../../lib/telegramBot';
import { getStudentsFromSheet } from '../../../lib/googleSheets';
import { generateAIMessage } from '../../../lib/groqAPI';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, callback_query } = req.body;

    // Handle regular messages
    if (message) {
      const chatId = message.chat.id;
      const text = (message.text || '').toLowerCase();
      const firstName = message.from.first_name;

      console.log(`Message from ${firstName} (${chatId}): ${text}`);

      // Help command
      if (text === '/help' || text.includes('help')) {
        const helpText = `🎯 <b>Shine Bot Commands</b>

/today - Get today's task
/progress - Check your progress
/weak - Focus on weak subjects
/chat - Chat with Shine
/help - Show this menu

Type any of these commands! 💪`;
        await sendTelegramMessage(chatId, helpText);
      }

      // Today's task
      else if (text === '/today' || text.includes('today')) {
        await sendTelegramMessage(
          chatId,
          `Let me prepare your task for today... ⏳`
        );
        await sendTelegramMessage(
          chatId,
          `📋 <b>Today's Focus</b>\n\nLet's tackle one weak area for 30 minutes. You'll feel the difference! 💪`
        );
      }

      // Progress
      else if (text === '/progress' || text.includes('progress')) {
        await sendTelegramMessage(
          chatId,
          `📊 <b>Your Progress</b>\n\nKeep pushing! Every day of consistency compounds. You're doing great! 🚀`
        );
      }

      // Weak subjects
      else if (text === '/weak' || text.includes('weak')) {
        await sendTelegramMessage(
          chatId,
          `💡 <b>Weak Subject Focus</b>\n\nLet's break it down step by step. Which topic should we start with?`
        );
      }

      // Chat with Shine
      else if (text === '/chat' || text.includes('chat')) {
        await sendTelegramMessage(
          chatId,
          `👋 Hey ${firstName}! I'm here for you. What's on your mind? Any exam worries, study challenges, or just need motivation?`
        );
      }

      // Default response
      else if (text.length > 0) {
        await sendTelegramMessage(
          chatId,
          `Got it! I'm learning from you. Type /help to see what I can do. 💪`
        );
      }
    }

    // Handle callback queries (button presses)
    if (callback_query) {
      const { id: callbackId, from, data } = callback_query;
      const chatId = from.id;
      const firstName = from.first_name;

      console.log(`Callback from ${firstName}: ${data}`);

      if (data === 'start_jamb') {
        await sendTelegramMessage(
          chatId,
          `Great! Let's crush that JAMB exam together. What's your target score? 🎯`
        );
      } else if (data === 'learn_skill') {
        await sendTelegramMessage(
          chatId,
          `Awesome! Learning a skill is the best decision. Which skill interests you most? (Design, Video Editing, Freelancing, etc.) 🚀`
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: true }); // Always return 200 to Telegram
  }
               }
