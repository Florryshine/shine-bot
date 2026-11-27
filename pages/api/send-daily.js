// pages/api/send-daily.js — Daily motivation cron (v1 feature, repaired).
//
// Audit fixes applied here:
//   * accepts GET (Vercel cron sends GET — the old POST-only handler 405'd every
//     cron invocation) as well as POST for manual triggers;
//   * auth: Vercel automatically attaches `Authorization: Bearer $CRON_SECRET`
//     when that env var exists; requests carrying x-vercel-cron (the scheduler)
//     or a valid secret pass, everyone else is rejected;
//   * reads the SAME canonical `students` schema as everything else (the old
//     version read tab `Sheet1` with a different column layout);
//   * AI-personalised motivation via lib/ai (responsibility 5), with static
//     fallback templates so a Groq outage still delivers messages;
//   * updateLastMessageSent() now really writes the sheet (was a stub);
//   * 429-aware sending (lib/telegram/client) + pacing delay;
//   * no raw sheet dumps in logs.

import appConfig from '../../lib/config.js';
import logger from '../../lib/logger.js';
import { makeTelegramClient } from '../../lib/telegram/client.js';
import { getStudents, updateLastMessageSent, isEligibleForDaily } from '../../lib/googleSheets.js';
import { generateShineMessage, pickMessageTypeAndTone } from '../../lib/ai/motivation.js';

export const config = { maxDuration: 60 };

const FALLBACK_MESSAGES = [
  "🌟 Good morning! Remember, every small step forward is progress. You've got this! 💪",
  '☀️ Rise and shine! Today is a great day to tackle those weak subjects. Let’s go! 🚀',
  '💡 New day, new opportunities! Stay focused, stay determined. You’re closer to your goals than you think! 🎯',
  '🔥 It’s a fresh start! Don’t let yesterday’s struggles define today. Push forward! 💯',
  '✨ Morning motivation: Consistency beats perfection. One day at a time! 🏆',
  '🌈 You’re stronger than your challenges. Keep grinding! 💪',
  '⭐ Today’s a perfect day to show yourself what you’re made of! Let’s do this! 🎓',
];

function checkAuth(req) {
  const isVercelCron = Boolean(req.headers['x-vercel-cron']);
  if (isVercelCron) return true;
  if (!appConfig.cronSecret()) return false;
  const header = req.headers.authorization || '';
  return header === `Bearer ${appConfig.cronSecret()}`;
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function runDaily({ sendReport = true, telegram = makeTelegramClient() } = {}) {
  const startTime = Date.now();
  const students = await getStudents();
  const eligible = students.filter(isEligibleForDaily);

  logger.info(`daily: ${students.length} students, ${eligible.length} eligible`);

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const student of eligible) {
    try {
      const { tone, messageType, daysInactive, daysToExam } = pickMessageTypeAndTone(student);
      let body;
      try {
        body = await generateShineMessage(student);
      } catch (aiErr) {
        // Static fallback preserved from v1.
        body = FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
        body += `\n\nYour current focus: ${student.weak_subjects || 'General Review'}${student.target_scores ? ` · Target: ${student.target_scores}` : ''}\nKeep pushing! 🌟`;
        logger.warn(`daily: AI failed for ${student.name}, used template (${aiErr.message})`);
      }
      const message = `${body}\n\n— Shine, Shiney Brain Academy 🤖`;
      await telegram.sendMessage(student.telegram_id, message);
      sent++;
      await updateLastMessageSent(student.row_number, new Date().toISOString().split('T')[0]);
      // ~12.5 msg/s: comfortably inside Telegram limits.
      await new Promise((r) => setTimeout(r, 80));
    } catch (error) {
      failed++;
      errors.push({ student: student.name, reason: error.message });
      logger.warn(`daily: failed for ${student.name}: ${error.message}`);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const summary = { eligible: eligible.length, sent, failed, skipped: students.length - eligible.length, durationSec };
  logger.info(`daily done: ${JSON.stringify(summary)}`);

  if (sendReport && appConfig.adminGroupId) {
    try {
      const lines = [
        '🌅 <b>Daily message report</b>',
        `✅ Sent: ${sent} · ❌ Failed: ${failed} · ⏭️ Skipped: ${students.length - eligible.length}`,
        errors.length ? `⚠️ First failures: ${errors.slice(0, 5).map((e) => `${e.student} (${e.reason})`).join('; ')}` : '',
      ].filter(Boolean);
      await telegram.sendMessage(appConfig.adminGroupId, lines.join('\n'));
    } catch {
      /* report is best-effort */
    }
  }

  return summary;
}

export default async function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const summary = await runDaily();
    return res.status(200).json({ success: true, ...summary });
  } catch (error) {
    logger.error(`daily failed: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// Testable export.
export { runDaily };
