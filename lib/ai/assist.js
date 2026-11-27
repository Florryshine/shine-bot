// lib/ai/assist.js — Shared date helpers for profile-aware prompts (carried
// over from v1 groqAPI.js so behaviour is unchanged).

export function calculateDaysUntil(examDate) {
  if (!examDate) return 999;
  const exam = new Date(examDate);
  if (Number.isNaN(exam.getTime())) return 999;
  const today = new Date();
  const days = Math.ceil((exam - today) / (1000 * 60 * 60 * 24));
  return days > 0 ? days : 0;
}

export function calculateDaysInactive(lastActive) {
  if (!lastActive) return 0;
  const last = new Date(lastActive);
  if (Number.isNaN(last.getTime())) return 0;
  const today = new Date();
  return Math.floor((today - last) / (1000 * 60 * 60 * 24));
}
