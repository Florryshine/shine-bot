// lib/ai/motivation.js — Responsibility 5: motivational / daily message
// generation, profile-aware (carried over and upgraded from v1's
// generateShineMessage: same message-type logic, now on the current model).

import appConfig from '../config.js';
import { callAI } from './client.js';
import { motivationPrompt } from './prompts.js';
import { calculateDaysUntil, calculateDaysInactive } from './assist.js';

export function pickMessageTypeAndTone(student) {
  const daysToExam = calculateDaysUntil(student?.exam_date);
  const daysInactive = calculateDaysInactive(student?.last_active);

  let messageType = 'motivation';
  let tone = 'friendly';
  if (daysInactive > 3) {
    messageType = 'inactivity_concern';
    tone = 'caring';
  } else if (daysToExam < 7 && daysToExam > 0) {
    messageType = 'exam_urgency';
    tone = 'urgent';
  } else if (student?.confidence && student.confidence < 5) {
    messageType = 'encouragement';
    tone = 'very_supportive';
  }
  return { messageType, tone, daysToExam, daysInactive };
}

export async function generateShineMessage(student, overrides = {}) {
  const { messageType, tone, daysToExam, daysInactive } = pickMessageTypeAndTone(student);

  try {
    const res = await callAI({
      messages: [{
        role: 'user',
        content: motivationPrompt(student, { messageType, tone, daysInactive, daysUntilExam: daysToExam }),
      }],
      model: appConfig.models.motivation,
      maxTokens: 250,
      temperature: 0.7,
      reasoningEffort: appConfig.reasoningEffort.motivation,
      label: 'motivation',
    }, overrides);
    return res.content;
  } catch (error) {
    // v1 fallback template preserved.
    const firstWeak = (student?.weak_subjects || 'your subjects').split(',')[0].trim();
    return `Hey ${student?.name || 'there'}! 👋\n\nYour ${student?.exam || 'exam'} exam is coming up. Let's focus on ${firstWeak} today. You got this! 💪`;
  }
}

// v1's welcome generator, preserved (identity + fallback).
export async function generateWelcomeMessage(name, overrides = {}) {
  try {
    const res = await callAI({
      messages: [{
        role: 'user',
        content: `You are Shine, welcoming a brand new student to Shiney Brain Academy. Their name is ${name}.\n\nWrite a warm 2-sentence welcome in casual Nigerian style. Tell them to use /help to see what you can do. Just the message, plain text.`,
      }],
      model: appConfig.models.chat,
      maxTokens: 120,
      temperature: 0.8,
      reasoningEffort: 'low',
      label: 'welcome',
    }, overrides);
    return res.content;
  } catch {
    return `Welcome to Shiney Brain Academy, ${name}! 🚀 I'm Shine, your personal study coach — type /help to see everything I can do for you!`;
  }
}
