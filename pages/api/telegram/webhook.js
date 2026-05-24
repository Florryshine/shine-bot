import { sendMessage } from '../../../lib/telegramBot';
import { getStudentsFromSheet, appendStudentToSheet, updateStudentInSheet } from '../../../lib/googleSheets';
import { generateAIMessage } from '../../../lib/groqAPI';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, callback_query } = req.body;

    // 1. Handle regular text messages
    if (message && message.text) {
      const chatId = message.chat.id.toString();
      const text = message.text.trim();
      const textLower = text.toLowerCase();
      const firstName = message.from.first_name || "there";

      console.log(`Message from ${firstName} (${chatId}): ${text}`);

      // Fetch all students to check if this user is already registered
      const students = await getStudentsFromSheet();
      const currentStudent = students.find(s => s.telegram_id.toString() === chatId);

      // --- AUTOMATED ONBOARDING LOGIC ---
      if (!currentStudent || currentStudent.onboarding_status !== 'completed') {
        
        // CASE A: Completely New Student (Not in Google Sheet yet)
        if (!currentStudent) {
          await appendStudentToSheet({
            telegram_id: chatId,
            name: '',
            student_type: '',
            target_course: '',
            weak_subject: '',
            target_jamb_score: '',
            current_skill: '',
            confidence_level: '',
            last_message_sent: new Date().toISOString().split('T')[0],
            onboarding_status: 'awaiting_name'
          });

          await sendMessage(
            chatId, 
            `🌟 <b>Welcome to Shiney Brain Academy!</b> 🌟\n\nI am <b>Shine</b>, your personal AI study and skill companion. I'm going to help you smash your goals this year!\n\nTo get started, what is your <b>full name</b>?`
          );
          return res.status(200).json({ success: true });
        }

        // CASE B: Processing Onboarding Step-by-Step
        const currentStatus = currentStudent.onboarding_status;

        if (currentStatus === 'awaiting_name') {
          await updateStudentInSheet(chatId, { name: text, onboarding_status: 'awaiting_type' });
          await sendMessage(
            chatId,
            `Great to meet you, ${text}! 🎓\n\nWhat program are you focusing on right now?\nType <b>JAMB</b>, <b>Post-UTME</b>, or <b>Skill Acquisition</b>.`
          );
          return res.status(200).json({ success: true });
        } 
        else if (currentStatus === 'awaiting_type') {
          await updateStudentInSheet(chatId, { student_type: text, onboarding_status: 'awaiting_course' });
          await sendMessage(
            chatId,
            `Got it! What is your dream university course or ultimate career goal? (e.g., Medicine, Nursing, Software Engineering)`
          );
          return res.status(200).json({ success: true });
        } 
        else if (currentStatus === 'awaiting_course') {
          await updateStudentInSheet(chatId, { target_course: text, onboarding_status: 'awaiting_weakness' });
          await sendMessage(
            chatId,
            `Incredible choice! To help you prepare perfectly, which subject or topic gives you the most headache right now? 🧠`
          );
          return res.status(200).json({ success: true });
        } 
        else if (currentStatus === 'awaiting_weakness') {
          await updateStudentInSheet(chatId, { weak_subject: text, onboarding_status: 'awaiting_score' });
          await sendMessage(
            chatId,
            `Understood. We will turn that weakness into your strength! 💪\n\nIf you are writing JAMB, what is your target score? (If not, just type 'None')`
          );
          return res.status(200).json({ success: true });
        } 
        else if (currentStatus === 'awaiting_score') {
          await updateStudentInSheet(chatId, { 
            target_jamb_score: text, 
            onboarding_status: 'completed',
            last_message_sent: new Date().toISOString().split('T')[0]
          });
          await sendMessage(
            chatId,
            `🎉 <b>Profile Setup Complete!</b> 🎉\n\nYour details have been registered into the Shiney Brain ecosystem. From tomorrow morning, I will begin tracking your goals daily.\n\nFeel free to ask me any study questions or type /help to see what I can do! ✨`
          );
          return res.status(200).json({ success: true });
        }
      }

      // --- REGULAR BOT COMMANDS (Only runs AFTER onboarding is completed) ---
      if (currentStudent && currentStudent.onboarding_status === 'completed') {
        if (textLower === '/help' || textLower === 'help') {
          const helpText = `🎯 <b>Shine Bot Commands</b>\n\n/today - Get today's task\n/progress - Check your progress\n/weak - Focus on weak subjects\n/chat - Chat with Shine\n/help - Show this menu\n\nType any of these commands! 💪`;
          await sendMessage(chatId, helpText);
          return res.status(200).json({ success: true });
        }
        else if (textLower === '/today' || textLower.includes('today')) {
          await sendMessage(chatId, 'Let me prepare your task for today... ⏳');
          await sendMessage(chatId, `📋 <b>Today's Focus</b>\n\nLet's tackle your weak area (<b>${currentStudent.weak_subject}</b>) for 30 minutes today. Your target of ${currentStudent.target_course} requires consistency! 💪`);
          return res.status(200).json({ success: true });
        }
        else if (textLower === '/progress' || textLower.includes('progress')) {
          await sendMessage(chatId, `📊 <b>Your Progress</b>\n\nKeep pushing, ${currentStudent.name}! Every day of consistency compounds. You're doing great! 🚀`);
          return res.status(200).json({ success: true });
        }
        else if (textLower === '/weak' || textLower.includes('weak')) {
          await sendMessage(chatId, `💡 <b>Weak Subject Focus</b>\n\nLet's break down <b>${currentStudent.weak_subject}</b> step by step. Which specific topic should we start with?`);
          return res.status(200).json({ success: true });
        }
        else if (textLower === '/chat' || textLower.includes('chat')) {
          await sendMessage(chatId, `👋 Hey ${currentStudent.name}! I'm here for you. What's on your mind? Any exam worries, study challenges, or just need motivation?`);
          return res.status(200).json({ success: true });
        }

        // --- FALLBACK TO DYNAMIC AI BRAIN ---
        else {
          try {
            await sendMessage(chatId, `Shine is typing... 🧠`);

            const contextPrompt = `
              You are Shine, an enthusiastic, direct, and deeply caring Nigerian study companion and mentor for Shiney Brain Academy. 
              You are talking to ${currentStudent.name}, who wants to study ${currentStudent.target_course} and struggles with ${currentStudent.weak_subject}. 
              Answer their query warmly, use encouragement, keep it conversational, and drop a Nigerian pidgin/slang expression occasionally (like "Oya," "No shaking," or "Let's run it").
              Student's message: ${text}
            `;

            const aiResponse = await generateAIMessage(contextPrompt);
            await sendMessage(chatId, aiResponse);
            return res.status(200).json({ success: true });
          } catch (aiError) {
            console.error("AI Generation failed:", aiError);
            await sendMessage(chatId, `Ouse! I'm having a small connection glitch. Let's try that again in a second.`);
            return res.status(200).json({ success: true });
          }
        }
      }
    }

    // 2. Handle callback queries (Inline button presses)
    if (callback_query) {
      const { id: callbackId, from, data } = callback_query;
      const chatId = from.id.toString();
      const firstName = from.first_name || "there";

      console.log(`Callback from ${firstName}: ${data}`);

      if (data === 'start_jamb') {
        await sendMessage(
          chatId,
          `Great! Let's crush that JAMB exam together. What's your target score? 🎯`
        );
      } else if (data === 'learn_skill') {
        await sendMessage(
          chatId,
          `Awesome! Learning a skill is the best decision. Which skill interests you most? (Design, Video Editing, Freelancing)`
        );
      }

      return res.status(200).json({ success: true });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
