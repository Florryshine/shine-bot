# Shine Bot 🌟

**Shine** is the AI student companion and human-mentorship bridge for
**Shiney Brain Academy** — a Telegram bot (`@Coachflorryshinebot`) that talks
with students 24/7, knows when a conversation needs the human mentor
(Florryshine), keeps Florry in the loop in a private mentorship inbox, and can
broadcast announcements to every registered student.

> **Start here if you are deploying or upgrading:** [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md)
> (deployment steps + what changed) and [`SECURITY.md`](SECURITY.md)
> (credential rotation — read this FIRST if you came from v1).

## What it does

**For students (private chat with the bot)**
- Auto-registration with a welcome message; profile lives in Google Sheets.
- 24/7 AI conversation (Groq, `openai/gpt-oss-120b` by default) with memory of
  the recent conversation and the student's profile (exam, weak subjects, goals).
- Tutor mode for academic questions — step-by-step explanations with exam angles.
- Commands: `/start` `/help` `/today` `/progress` `/weak` `/chat`.
- Voice notes / photos / documents are forwarded to the mentorship inbox.
- Serious personal, family or health topics are **not** answered with generic
  motivation: the bot acknowledges warmly and tells the student Florry has been
  notified (she then replies from the admin group).
- Safety crises (self-harm, abuse, medical emergency) get immediate guidance
  (112) plus an urgent alert to Florry — the bot never says "wait".

**For Florry (private admin group = mentorship inbox)**
- Every student message and every AI reply arrives tagged 🟢 / 🟠 / 🚨 with the
  student's name, chat id, profile and classification.
- **Reply directly to any mirrored message** to answer that exact student —
  text, voice note, photo or document. Confirmation appears in the group.
  Routing uses persistent message-ID mappings, never message-text parsing.
- `/broadcast` — draft → preview → **CONFIRM / CANCEL** → delivery report.
  Supports text, voice notes, images, documents, PDFs (forwards too).
- `/broadcasthistory` — last broadcasts with sent/failed counts.
- `/id` — show your Telegram id for `ADMIN_TELEGRAM_IDS`.
- Daily cron (08:00 UTC) sends AI-personalised motivational messages to eligible
  students and posts a summary report.

## Architecture (v2)

```
pages/api/telegram/webhook.js   orchestrator: secret check → dedup → route
pages/api/telegram/setup.js     protected webhook registration (sets secret)
pages/api/send-daily.js         cron (GET from Vercel, POST manual) + report
lib/config.js                   ALL env config + AI model slots in one place
lib/telegram/client.js          Bot API client: 429 retry-after, retries, media
lib/ai/client.js                single Groq entrypoint, model fallback chain
lib/ai/classify.js              GREEN/ORANGE/RED routing (fast path + LLM)
lib/ai/chat.js                  student conversation (context-aware)
lib/ai/tutor.js                 academic explanations
lib/ai/motivation.js            daily motivation + welcome (responsibility 5)
lib/ai/prompts.js               persona + every prompt in one file
lib/inbox.js                    mentorship inbox mirroring + persistent mappings
lib/broadcast.js                draft → confirm → deliver engine + history
lib/store/                      message mappings & conversations:
                                  Google Sheets (default), Upstash Redis, memory
lib/googleSheets.js             student records (header-driven schema, repaired)
scripts/repair-sheet.js         one-time sheet repair (run with real creds)
tests/                          offline test suite (node --test)
```

## Development

```bash
npm install
cp .env.example .env.local      # fill in real values (never commit)
npm run dev                     # local server on :3000
npm test                        # offline test suite (no network needed)
```

Expose the webhook locally (optional): `npx localtunnel --port 3000` or use
ngrok, then register it via `/api/telegram/setup`.

See [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) for environment variables, the
Google Sheets schema, deployment steps, test evidence, known limitations and
rollback instructions.
