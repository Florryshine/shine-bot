// pages/api/test-send.js — Manual smoke test for the daily-message pipeline.
//
// Audit fix: the v1 endpoint was a completely open GET that sent a message to
// the first active student and returned their name + Telegram id to ANY caller
// (student PII disclosure + free message-sending for strangers). It is now
// locked behind ADMIN_API_SECRET and returns no PII.

import config from '../../lib/config.js';
import logger from '../../lib/logger.js';
import { makeTelegramClient } from '../../lib/telegram/client.js';
import { getStudents } from '../../lib/googleSheets.js';
import { generateShineMessage } from '../../lib/ai/motivation.js';

export default async function handler(req, res) {
  if (!config.adminApiSecret) {
    return res.status(503).json({ error: 'ADMIN_API_SECRET is not configured' });
  }
  const provided = req.headers['x-admin-secret'] || req.query.secret;
  if (provided !== config.adminApiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const students = await getStudents();
    const student = students.find((s) => s.status === 'active') || students[0];
    if (!student) {
      return res.status(404).json({ error: 'No registered students found' });
    }

    const message = await generateShineMessage(student);
    const telegram = makeTelegramClient();
    await telegram.sendMessage(student.telegram_id, message);

    // No PII in the response: only that a send happened and to whom by row.
    return res.status(200).json({
      success: true,
      sentTo: { student_row: student.row_number, status: student.status },
      messageLength: message.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`test-send failed: ${error.message}`);
    return res.status(500).json({ success: false, error: error.message });
  }
}
