// pages/api/telegram/setup.js — One-shot webhook registration, protected by
// ADMIN_API_SECRET. Sets the webhook WITH a secret token (Phase 8) and the
// update types v2 needs (callback_query for broadcast buttons).
//
// Usage (after deploying):
//   curl -X POST https://<vercel-url>/api/telegram/setup \
//     -H "x-admin-secret: $ADMIN_API_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"webhookUrl": "https://<vercel-url>/api/telegram/webhook"}'

import config from '../../../lib/config.js';
import logger from '../../../lib/logger.js';
import { makeTelegramClient } from '../../../lib/telegram/client.js';

export default async function handler(req, res) {
  if (!config.adminApiSecret) {
    return res.status(503).json({ error: 'ADMIN_API_SECRET is not configured' });
  }
  if (req.headers['x-admin-secret'] !== config.adminApiSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const telegram = makeTelegramClient();
  if (!telegram.tokenPresent) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const url = body.webhookUrl || '';
    if (!/^https:\/\/.+\/api\/telegram\/webhook$/.test(url)) {
      return res.status(400).json({ error: 'webhookUrl must be an https URL ending in /api/telegram/webhook' });
    }
    try {
      await telegram.setWebhook(url, config.webhookSecret || undefined, [
        'message', 'edited_message', 'callback_query',
      ]);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const info = await telegram.getWebhookInfo();
    return res.status(200).json({ ok: true, webhook: info.data?.result || info.result || info });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
