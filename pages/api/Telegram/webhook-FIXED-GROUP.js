import { sendMessage } from '../../../lib/telegramBot';
import { getStudents, addNewStudent, updateLastMessageSent } from '../../../lib/googleSheets';
import { generateShineMessage, generateAIReply, generateWelcomeMessage } from '../../../lib/groqAPI';

// Admin group ID - all student messages forward here
const ADMIN_GROUP_ID = -1003881055286;

// Auto-forward student messages to admin group
async function forwardToAdminGroup(student, text, chatId) {
  try {
    const adminMessage = `
👤 <b>From:</b> ${student.name} (${student.student_id || 'Unknown'})
🆔 <b>Telegram ID:</b> <code>${chatId}</code>

📝 <b>Message:</b>
${text}

<b>━━━━━━━━━━━━━━━━━━</b>
💬 Reply in this group to respond to ${student.name}
`;

    await sendMessage(ADMIN_GROUP_ID, adminMessage);
  } catch (error) {
    console.error('Error forwarding to admin group:', error);
  }
}

// Handle admin replies from the admin group
async function handleAdminReply(req) {
  const { message } = req.body;
  
  // Check if message is from the admin group
  if (!message || message.chat.id !== ADMIN_GROUP_ID) {
    return false;
  }

  // Check if this is a reply to another message
  if (!message.reply_to_message) {
    return false;
  }

  // Extract student ID from the forwarded message text
  const replyText = message.reply_to_message.text || '';
  const studentIdMatch = replyText.match(/🆔 <b>Telegram ID:<\/b> <code>(\d+)<\/code>/);

  if (!studentIdMatch) {
    return false;
  }

  const studentChatId = studentIdMatch[1];
  const adminReplyText = message.text;

  // Send admin's reply to the student
  try {
    const formattedReply = `
📩 <b>Coach Florryshine:</b>

${adminReplyText}
    `;
    
    await sendMessage(studentChatId, formattedReply);
    await sendMessage(ADMIN_GROUP_ID, `✅ Message sent to student!`);
    
    return true;
  } catch (error) {
    console.error('Error sending admin reply:', error);
    await sendMessage(ADMIN_GROUP_ID, `❌ Error sending message: ${error.message}`);
    return false;
  }
}

// Broadcast message to all students
async function broadcastToAllStudents(message) {
  try {
    const students = await getStudents();
    
    let successCount = 0;
    let failCount = 0;

    for (const student of students) {
      try {
        const formattedMsg = `
📢 <b>Announcement from Shiney Brain Academy</b>

${message}

━━━━━━━━━━━━━━━━
Shine Bot 🤖
        `;
        
        await sendMessage(student.telegram_id, formattedMsg);
        successCount++;
      } catch (err) {
        console.error(`Failed to send to ${student.name}:`, err);
        failCount++;
      }
    }

    // Report to admin
    const report = `
✅ Broadcast Complete!

📤 Sent: ${successCount} students
❌ Failed: ${failCount} students

Message:
"${message}"
    `;
    
    await sendMessage(ADMIN_GROUP_ID, report);
  } catch (error) {
    console.error('Broadcast error:', error);
    await sendMessage(ADMIN_GROUP_ID, `❌ Broadcast failed: ${error.message}`);
  }
}

// Main handler
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    // === Ignore messages from groups - only handle private messages ===
    if (message && message.chat.type !== 'private') {
      console.log('Message from group - checking if admin reply...');
      
      // But still check for admin replies in the group
      const isAdminReply = await handleAdminReply(req);
      if (isAdminReply) {
        return res.status(200).json({ success: true });
      }

      // Check for broadcast command
      if (message && message.chat.id === ADMIN_GROUP_ID) {
        const text = (message.text || '').trim();
        
        if (text.startsWith('/broadcast ')) {
          const broadcastMsg = text.replace('/broadcast ', '').trim();
          await broadcastToAllStudents(broadcastMsg);
          return res.status(200).json({ success: true });
        }
      }

      // Ignore other group messages
      console.log('Ignoring group message that is not admin reply or broadcast');
      return res.status(200).json({ success: true });
    }

    // === Handle regular student messages (PRIVATE ONLY) ===
    if (message && message.text && message.chat.type === 'private') {
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

      // === NEW: Forward message to admin group ===
      await forwardToAdminGroup(currentStudent, text, chatId);

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
