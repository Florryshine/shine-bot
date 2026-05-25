import { sendMessage } from '../../../lib/telegramBot';
import { getStudents, addNewStudent, updateLastMessageSent } from '../../../lib/googleSheets';
import { generateShineMessage, generateAIReply, generateWelcomeMessage } from '../../../lib/groqAPI';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    if (message && message.text) {
      const chatId = message.chat.id.toString();
      const text = message.text.trim();
      const textLower = text.toLowerCase();
      const firstName = message.from.first_name || 'there';

      console.log(`--- Message from ${firstName} (ID: ${chatId}): ${text} ---`);

      // Fetch all students
      const students = await getStudents();
      const currentStudent = students.find(s => s.telegram_id.toString().trim() === chatId.trim());

      console.log(`Total students: ${students.length}, Found: ${!!currentStudent}`);

      // ── AUTO-REGISTER new students ──
      if (!currentStudent) {
        console.log(`New user detected: ${firstName} (${chatId}) — auto-registering...`);

        // Add them to the sheet
        await addNewStudent(chatId, firstName);

        // Send welcome message
        const welcomeMsg = await generateWelcomeMessage(firstName);
        await sendMessage(chatId, welcomeMsg);

        const helpText = `🎯 <b>Here's what I can do for you:</b>\n\n/today - Get today's study task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with me about anything\n/help - Show this menu\n\nOr just type any question and I'll answer! 💪`;
        await sendMessage(chatId, helpText);

        return res.status(200).json({ success: true });
      }

      // ── COMMANDS ──
      if (textLower === '/start') {
        const msg = await generateShineMessage(currentStudent);
        await sendMessage(chatId, msg);
        return res.status(200).json({ success: true });
      }

      if (textLower === '/help' || textLower === 'help') {
        const helpText = `🎯 <b>Shine Bot Commands</b>\n\n/today - Get today's task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with Shine\n/help - Show this menu\n\nOr just type ANY question — I'll answer it! 💪`;
        await sendMessage(chatId, helpText);
        return res.status(200).json({ success: true });
      }

      if (textLower === '/today') {
        await sendMessage(chatId, 'Let me prepare your task for today... ⏳');
        const taskMsg = `📋 <b>Today's Focus</b>\n\nLet's tackle your weak area (<b>${currentStudent.weak_subjects || 'General Review'}</b>) for 30 minutes today. You've got this! 💪`;
        await sendMessage(chatId, taskMsg);
        return res.status(200).json({ success: true });
      }

      if (textLower === '/progress') {
        const progressMsg = `📊 <b>Your Progress</b>\n\nKeep pushing, ${currentStudent.name}! Every day of consistency compounds. You're doing great! 🚀`;
        await sendMessage(chatId, progressMsg);
        return res.status(200).json({ success: true });
      }

      if (textLower === '/weak') {
        const weakMsg = `💡 <b>Weak Subject Focus</b>\n\nLet's break down <b>${currentStudent.weak_subjects || 'your challenges'}</b> step by step. Which specific topic should we start with?`;
        await sendMessage(chatId, weakMsg);
        return res.status(200).json({ success: true });
      }

      // ── AI REPLY for /chat and ALL free text messages ──
      // This handles: /chat, any question, any message that isn't a command
      try {
        await sendMessage(chatId, `Shine is typing... 🧠`);
        const aiResponse = await generateAIReply(currentStudent, text);
        await sendMessage(chatId, aiResponse);

        try {
          await updateLastMessageSent(chatId, new Date().toISOString().split('T')[0]);
        } catch (updateErr) {
          console.error('Error updating last message:', updateErr);
        }

        return res.status(200).json({ success: true });
      } catch (aiError) {
        console.error('AI Generation failed:', aiError);
        await sendMessage(chatId, `Oof! I had a small glitch. Try asking again in a second 😊`);
        return res.status(200).json({ success: true });
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
