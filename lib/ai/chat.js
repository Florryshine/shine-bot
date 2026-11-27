// lib/ai/chat.js — Responsibility 1: student conversation (context-aware).
import appConfig from '../config.js';
import { callAI } from './client.js';
import { chatSystemPrompt } from './prompts.js';
import { calculateDaysUntil, calculateDaysInactive } from './assist.js';

export async function generateAIReply({ student, userMessage, history = [], overrides = {} }) {
  const extra = {
    daysUntilExam: calculateDaysUntil(student?.exam_date),
    daysInactive: calculateDaysInactive(student?.last_active),
  };

  const messages = [
    { role: 'system', content: chatSystemPrompt(student, extra) },
    ...history.slice(-appConfig.conversationHistoryTurns).map((h) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  try {
    const res = await callAI({
      messages,
      model: appConfig.models.chat,
      maxTokens: 500,
      temperature: 0.7,
      reasoningEffort: appConfig.reasoningEffort.chat,
      label: 'chat',
    }, overrides);
    return res.content;
  } catch (error) {
    // Preserve v1 behaviour: a friendly fallback, never a hard failure.
    return `Hey ${student?.name || 'there'}! 😊 I had a little glitch there. Can you ask me again? I'm all ears!`;
  }
}
