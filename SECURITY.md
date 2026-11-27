# SECURITY

## 1. Exposed credentials — ROTATION REQUIRED (do this first)

The repository's git history (all versions up to `50d66a2`, May 2026) contains
live credentials in plain text in the documentation files. Deleting the files in
a new commit does **not** remove them from history. All of the following must
be treated as compromised and rotated:

| Credential | Found in | Rotate by |
|---|---|---|
| Telegram bot token | `00_READ_ME_FIRST.md`, `DEPLOYMENT_GUIDE.md`, `START_HERE.md`, `QUICKSTART.md`, `PROJECT_STRUCTURE.md`, `INDEX.md` (also inside `curl` URLs) | Telegram → @BotFather → `/mybots` → the bot → API Token → **Revoke current token**. Update `TELEGRAM_BOT_TOKEN` in Vercel. |
| Groq API key | same six files | console.groq.com → API Keys → delete the exposed key, create a new one. Update `GROQ_API_KEY` in Vercel. |
| Google Sheet ID | all seven doc files | Not a secret per se, but set the sheet to **Restricted** sharing (only the service account + owner) and audit Viewer links. |
| Example `CRON_SECRET` value (`<GENERATE_A_NEW_CRON_SECRET>...`) | `DEPLOYMENT_GUIDE.md`, `PROJECT_STRUCTURE.md` | If the real value resembles the example, set a fresh `openssl rand -hex 24` value in Vercel. |
| Admin group chat ID | hardcoded in old `webhook.js` | Moved to `ADMIN_GROUP_ID` env. Not directly abusable, but keep it out of public code going forward. |
| Google service-account credentials | never committed (good) — keep it that way | If ever pasted into a doc, delete the key in Google Cloud IAM immediately. |

Optional but recommended after rotation: rewrite history with
`git filter-repo --replace-text` (official tool and docs:
https://github.com/newren/git-filter-repo) and force-push, then have all
collaborators re-clone.

## 2. Secrets policy in v2

- Credentials live **only** in Vercel environment variables (or `.env.local`,
  which is git-ignored). `.env.example` documents every variable with a blank
  value and is the only env file in the repo.
- No documentation contains credential values. Nothing in `lib/`, `pages/` or
  `scripts/` hardcodes a token, key, or the admin group id.
- `lib/logger.js` redacts bot tokens and Groq keys and truncates student
  message content in logs. Raw Sheets responses are never dumped to the console.

## 3. Webhook security (Phase 8)

- `TELEGRAM_WEBHOOK_SECRET` is registered with Telegram via
  `/api/telegram/setup` (POST, `x-admin-secret` header). Every webhook call is
  validated against the `x-telegram-bot-api-secret-token` header; mismatches
  get 401. Without this, anyone who finds the endpoint can forge updates
  (spoofing student identities or the admin group).
- `update_id` deduplication in the persistent store prevents double processing
  when Telegram retries; handlers always answer 200 so failures never cause
  retry storms.
- `ADMIN_TELEGRAM_IDS` allow-list authorizes every admin command and broadcast.
  Send `/id` in the admin group to discover your id. While the list is empty,
  membership in the private admin group is trusted — set the list.
- `pages/api/test-send.js` and `/api/telegram/setup.js` require
  `ADMIN_API_SECRET`.

## 4. Student privacy

- Messages are mirrored to the private admin group (the mentorship inbox is its
  purpose) and stored minimally: mapping rows hold ids, direction, type and a
  500-char snippet; conversation rows hold the last messages needed for context.
  Both are pruned after `MAPPING_RETENTION_DAYS` / `CONVERSATION_RETENTION_DAYS`
  (30/60 default). Set Upstash Redis for cryptographically-isolated storage and
  hard TTLs.
- No student PII is returned by any API endpoint (test-send no longer exposes
  names or ids).
- Do not paste student messages into public issue trackers or third-party logs.

## 5. Reporting

If you discover a vulnerability, contact the repository owner privately. Do not
open public issues containing tokens, student names, or chat ids.
