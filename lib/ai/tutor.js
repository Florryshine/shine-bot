// lib/ai/tutor.js — Responsibility 2: academic explanations.
import appConfig from '../config.js';
import { callAI } from './client.js';
import { tutorSystemPrompt } from './prompts.js';
import { calculateDaysUntil, calculateDaysInactive } from './assist.js';

export async function generateTutorExplanation({ student, question, history = [], overrides = {} }) {
  const extra = {
    daysUntilExam: calculateDaysUntil(student?.exam_date),
    daysInactive: calculateDaysInactive(student?.last_active),
  };

  const messages = [
    { role: 'system', content: tutorSystemPrompt(student, extra) },
    ...history.slice(-6).map((h) => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content,
    })),
    { role: 'user', content: question },
  ];

  try {
    const res = await callAI({
      messages,
      model: appConfig.models.tutor,
      maxTokens: 900,
      temperature: 0.5,
      reasoningEffort: appConfig.reasoningEffort.tutor,
      label: 'tutor',
    }, overrides);
    return res.content;
  } catch (error) {
    return `Hey ${student?.name || 'there'}! 😊 I had a little glitch explaining that. Please ask me again and I'll break it down for you!`;
  }
}
