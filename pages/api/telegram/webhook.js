import { sendMessage } from '../../../lib/telegramBot';
import { getStudents, getStudentById, updateLastMessageSent } from '../../../lib/googleSheets';
import { generateShineMessage, generateWelcomeMessage } from '../../../lib/groqAPI';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    // Handle text messages
    if (message && message.text) {
      const chatId = message.chat.id.toString();
      const text = message.text.trim();
      const textLower = text.toLowerCase();
      const firstName = message.from.first_name || "there";

      console.log(`Message from ${firstName} (${chatId}): ${text}`);

      // Fetch all students
      const students = await getStudents();
      const currentStudent = students.find(s => s.telegram_id.toString() === chatId);

      // If student not found - send welcome message
      if (!currentStudent) {
        try {
          const welcomeMsg = await generateWelcomeMessage({ name: firstName });
          await sendMessage(chatId, welcomeMsg);
        } catch (err) {
          console.error('Welcome message error:', err);
          await sendMessage(chatId, `🌟 Welcome to Shiney Brain Academy! I'm Shine, your AI study companion. What's your name?`);
        }
        return res.status(200).json({ success: true });
      }

      // Handle commands
      if (textLower === '/help' || textLower === 'help') {
        const helpText = `🎯 <b>Shine Bot Commands</b>\n\n/today - Get today's task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with Shine\n/help - Show this menu\n\nType any of these commands! 💪`;
        await sendMessage(chatId, helpText);
        return res.status(200).json({ success: true });
      }
      else if (textLower === '/today' || textLower.includes('today')) {
        await sendMessage(chatId, 'Let me prepare your task for today... ⏳');
        const taskMsg = `📋 <b>Today's Focus</b>\n\nLet's tackle your weak area (<b>${currentStudent.weak_subjects || 'General Review'}</b>) for 30 minutes today. You've got this! 💪`;
        await sendMessage(chatId, taskMsg);
        return res.status(200).json({ success: true });
      }
      else if (textLower === '/progress' || textLower.includes('progress')) {
        const progressMsg = `📊 <b>Your Progress</b>\n\nKeep pushing, ${currentStudent.name}! Every day of consistency compounds. You're doing great! 🚀`;
        await sendMessage(chatId, progressMsg);
        return res.status(200).json({ success: true });
      }
      else if (textLower === '/weak' || textLower.includes('weak')) {
        const weakMsg = `💡 <b>Weak Subject Focus</b>\n\nLet's break down <b>${currentStudent.weak_subjects || 'your challenges'}</b> step by step. Which specific topic should we start with?`;
        await sendMessage(chatId, weakMsg);
        return res.status(200).json({ success: true });
      }
      else if (textLower === '/chat' || textLower.includes('chat')) {
        const chatMsg = `👋 Hey ${currentStudent.name}! I'm here for you. What's on your mind? Any exam worries, study challenges, or just need motivation?`;
        await sendMessage(chatId, chatMsg);
        return res.status(200).json({ success: true });
      }

      // Fallback to AI for any other message
      else {
        try {
          await sendMessage(chatId, `Shine is typing... 🧠`);

          const aiResponse = await generateShineMessage(currentStudent);
          await sendMessage(chatId, aiResponse);

          // Update last message sent
          try {
            await updateLastMessageSent(chatId, new Date().toISOString().split('T')[0]);
          } catch (updateErr) {
            console.error('Error updating last message:', updateErr);
          }

          return res.status(200).json({ success: true });
        } catch (aiError) {
          console.error("AI Generation failed:", aiError);
          await sendMessage(chatId, `Ouse! I'm having a small connection glitch. Let's try that again in a second. 😊`);
          return res.status(200).json({ success: true });
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
