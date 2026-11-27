# UPGRADE NOTES — Shine Bot v2 (implementation & operations)

Companion documents: [`AUDIT_REPORT.md`](AUDIT_REPORT.md) (Phase 1 findings),
[`SECURITY.md`](SECURITY.md) (credential rotation — do that FIRST),
[`README.md`](README.md) (overview).

---

## 1. What changed, in one paragraph

The bot keeps its v1 identity, student experience, commands, Google-Sheets
records and admin group, but the internals are modernised: the AI moves to
Groq's current production models through one central configuration
(`lib/config.js` → env vars, no more `llama-3.3-70b-versatile`, which Groq
retired on 2026-08-16 for self-serve tiers); incoming messages are classified
GREEN/ORANGE/RED and routed accordingly; every student message **and** every AI
reply is mirrored into the private admin group with a **persistent mapping**
(Telegram admin message id ↔ student chat id) so Florry's group replies always
reach the exact student; broadcasting becomes a draft → preview → CONFIRM/
CANCEL workflow with rate-limit handling, retries, per-student delivery
records and history; the webhook validates a secret token, deduplicates
`update_id`s and answers 200 always; Google Sheets access is unified on one
header-driven schema and `updateLastMessageSent()` now really writes.

## 2. Files added / modified / removed

**Added**
- `lib/config.js` — central env config + AI model slots (Phase 2 requirement).
- `lib/logger.js` — secret-redacting, PII-safe logging.
- `lib/telegram/client.js` — Telegram client: 429 `retry_after`, retries,
  permanent-failure detection, text/voice/audio/photo/video/document sends,
  `copyMessage`, webhook registration.
- `lib/ai/client.js` — single Groq entrypoint: model fallback chain, timeout,
  retries, token-usage logging, JSON-schema structured outputs.
- `lib/ai/prompts.js` — persona + prompts for all five responsibilities.
- `lib/ai/chat.js`, `lib/ai/tutor.js`, `lib/ai/classify.js`, `lib/ai/motivation.js`,
  `lib/ai/assist.js` — the five separated responsibilities + date helpers.
- `lib/inbox.js` — mentorship inbox mirroring + persistent message mappings.
- `lib/broadcast.js` — broadcast state machine + delivery engine.
- `lib/store/index.js`, `lib/store/sheetsStore.js`, `lib/store/redisStore.js`,
  `lib/store/memoryStore.js` — persistent mapping/conversation/dedup stores.
- `pages/api/telegram/setup.js` — protected webhook registration endpoint.
- `scripts/repair-sheet.js` — one-time Google Sheet repair.
- `tests/*.mjs` — offline test suite.
- `AUDIT_REPORT.md`, `SECURITY.md`, `UPGRADE_NOTES.md`, `.env.example`.

**Modified**
- `pages/api/telegram/webhook.js` — full rewrite (routing, inbox, admin reply
  via mappings, broadcast hooks, secret validation, dedup, media support).
- `pages/api/send-daily.js` — GET for Vercel cron + auth, unified schema,
  AI personalisation with static fallback, real `updateLastMessageSent`, report.
- `pages/api/test-send.js` — locked behind `ADMIN_API_SECRET`, no PII returned.
- `lib/googleSheets.js` — header-driven canonical schema, normalised telegram
  ids, eligibility helpers, real `updateLastMessageSent`, `touchStudent`.
- `package.json` — `groq-sdk ^1.6.0` (was `^0.5.0`), `axios ^1.7.9`,
  `googleapis ^144.0.0`, `next ^14.2.5`, `engines.node >=20`, `npm test`.

**Removed**
- `00_READ_ME_FIRST.md`, `DEPLOYMENT_GUIDE.md`, `START_HERE.md`, `QUICKSTART.md`,
  `PROJECT_STRUCTURE.md`, `INDEX.md`, `VISUAL_SUMMARY.md` — these contained the
  leaked live credentials (see SECURITY.md §1) and duplicated content. Their
  useful content now lives in README/UPGRADE_NOTES/SECURITY with no secrets.

## 3. AI models & SDK (Phase 2)

- `groq-sdk` **^1.6.0** (current stable; zero runtime deps; needs Node ≥ 20 —
  Vercel's current default runtime). Published 2026-08-26.
- Defaults per responsibility (all changeable via env, never in code):

| Responsibility | Default model | Why |
|---|---|---|
| Student conversation | `openai/gpt-oss-120b` | quality flagship, production on Groq |
| Academic explanations | `openai/gpt-oss-120b` | best reasoning for teaching |
| Message classification | `openai/gpt-oss-20b` | fast + cheap + supports JSON-schema structured outputs |
| Human escalation ack | `openai/gpt-oss-20b` | short warm text, latency matters |
| Motivational messages | `openai/gpt-oss-120b` | personalised daily writes |
| Fallback chain | `gpt-oss-120b → gpt-oss-20b` | if a model id is retired again, requests fall through automatically |

- `llama-3.3-70b-versatile` (retired 2026-08-16 for self-serve; Enterprise-only)
  and `llama-3.1-8b-instant` (same) are **not** used anywhere.
- gpt-oss-120b on Groq: 131k context, ~470–650 tok/s, $0.15/$0.60 per 1M in/out.
  At academy scale (a few hundred AI replies/day) monthly cost stays well
  under $1 — effectively free-tier viable (30 req/min, 1k req/day free tier).
- `reasoning_effort` is set per responsibility (`low` for chat/classification,
  `medium` for tutor) to keep WhatsApp-speed replies.
- JSON-schema structured outputs (`response_format: {type:'json_schema'}`) are
  used for classification with an automatic `json_object` fallback.

## 4. Routing behaviour (Phase 3)

| Category | Trigger (meaning-based; fast path only for explicit phrases) | What happens |
|---|---|---|
| 🟢 GREEN | greetings, small talk, academic questions, JAMB help, study tips, normal motivation, hyperbolic exam jokes | AI answers directly (tutor mode if `is_academic`), reply mirrored to inbox |
| 🟠 ORANGE | emotional distress, family issues, health concerns, serious personal problems, persistent struggle, explicit "I want to talk to Florry" | empathetic ack to student (never pretending to be Florry), message mirrored with 🟠 tag, "Awaiting Florry" status in group |
| 🚨 RED | self-harm/suicide, abuse/violence, medical emergency (direct language; hyperbole goes to the LLM for intent) | immediate safety guidance incl. **112** to the student NOW + separate urgent alert in group |

Rules enforced in code: classifier failure defaults to ORANGE (human review);
ordinary academic questions never escalate; uncertain serious issues favour
human review; no medical/mental-health diagnosis anywhere.

## 5. Persistent stores & schema (Phases 4, 7)

**Student records (unchanged source of truth):** the `students` tab.
Reads are header-driven — column order can change safely; the canonical
headers are `userid, name, stage, exam, weak_subjects, target_scores, skills,
availability, streak, last_active, joined_date, student_id, telegram_id,
exam_date, confidence, skill_progress, status, goals, last_message_sent`.
If the tab still has the old fixed layout (no header row), v1's column order is
assumed automatically. Run `scripts/repair-sheet.js` once to append missing
headers, fix number-mangled telegram ids and default empty statuses.

**Bot bookkeeping (new, separate tabs — never mixed with student data):**
`bot_message_map` (admin group id, admin message id, student chat id, student
message id, conversation id, direction, message type, snippet, timestamp),
`bot_conversations`, `bot_updates` (dedup), `bot_command_state`,
`bot_broadcasts`, `bot_broadcast_log`. Created automatically on first use; the
map/conversations/updates tabs are pruned on a retention schedule (30/30/7 days
default). **Audit verdict on Sheets for this workload:** acceptable at academy
scale (tens of messages/day; lookups are full-tab scans of small pruned tabs).
Set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (Vercel KV = Upstash)
and the same interface moves to Redis with O(1) lookups and hard TTLs — no code
changes elsewhere. Verify against the checklist in AUDIT_REPORT.md §2 (Q10).

## 6. Environment variables

Required: `TELEGRAM_BOT_TOKEN` (rotated!), `GROQ_API_KEY` (rotated!),
`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`, `ADMIN_GROUP_ID`.
Strongly recommended: `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`,
`ADMIN_TELEGRAM_IDS`, `ADMIN_API_SECRET`.
Optional: model overrides (`GROQ_MODEL_*`, `GROQ_REASONING_*`,
`GROQ_MODEL_FALLBACKS`), Redis (`UPSTASH_REDIS_REST_URL/TOKEN`, `STORE_TYPE`),
tuning (`CONVERSATION_HISTORY_TURNS`, `MAPPING_RETENTION_DAYS`,
`CONVERSATION_RETENTION_DAYS`, `BROADCAST_SEND_DELAY_MS`, `MAX_BROADCAST_BATCH`).
Full list with explanations: `.env.example`.

## 7. Deployment instructions

1. **Rotate credentials** (SECURITY.md §1) — bot token via @BotFather, Groq key
   in console.groq.com.
2. Push this branch / apply the patch, then in **Vercel** (ONE project only —
   delete or disconnect any second project that points at this bot, otherwise
   the two will fight over the webhook):
   - Import/refresh the project; Framework preset: Next.js; Node 20 runtime.
   - Set every variable from `.env.example` (Production + Preview).
   - Deploy.
3. Create the bot bookkeeping is automatic; repair the student sheet once:
   locally run `scripts/repair-sheet.js` with real creds (see script header).
4. Register the webhook **with its secret**:
   ```bash
   curl -X POST https://<vercel-url>/api/telegram/setup \
     -H "x-admin-secret: $ADMIN_API_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"webhookUrl": "https://<vercel-url>/api/telegram/webhook"}'
   ```
   The response shows `getWebhookInfo`; confirm `url`, `pending_update_count: 0`
   and that no error is reported.
5. Send `/id` in the admin group and put your id into `ADMIN_TELEGRAM_IDS`, then
   redeploy (env change).
6. Add the bot to the private admin group (admin) and verify it mirrors a test
   student message.
7. Check Vercel → Crons shows `/api/send-daily` daily 08:00 UTC (GET).

## 8. Test evidence (Phase 9)

**Offline suite: 49/49 passing** (`npm test` — node:test, no network, all
external services faked), covering:

- **Routing (Phase 3)** — crisis fast-path catches real danger phrases and
  routes RED; exam hyperbole ("this maths wants to kill me") does **not**
  short-circuit; explicit "talk to Florry" routes ORANGE; classifier failure
  defaults to human review; unknown LLM categories default ORANGE.
- **Registration & pipeline (Q8)** — a brand-new student gets welcome + help
  AND their first message is answered and mirrored to the inbox with mappings
  (student + AI directions stored).
- **Mentorship inbox (Phase 4/6)** — reply to a mirrored student message
  reaches exactly that student; reply to an AI response also reaches the
  student; unmapped replies send nothing (no guessing); **two students A/B —
  a reply to A never reaches B**; voice notes mirror with `message_type=voice`.
- **Authorization (Phase 8)** — non-allow-listed admin command rejected and
  broadcast engine never invoked; webhook secret mismatch → 401 with zero
  processing; duplicate `update_id` → `duplicate:true` with no double sends;
  handler exceptions still answer 200 (no Telegram retry storms).
- **Broadcast (Phase 5)** — draft→preview with CONFIRM/CANCEL buttons;
  CONFIRM delivers only to eligible students (silent/inactive/empty-id
  excluded); redelivered CONFIRM callback is a no-op; CANCEL sends nothing;
  `/broadcast <text>` one-liner stops at preview (no accidental broadcast);
  voice-note drafts deliver as voice notes; blocked students recorded as
  failed with reasons in the report; history rows update in place.
- **Stores (Phase 4)** — Sheets-backed mappings survive across instances;
  newest mapping wins on re-sent ids; conversation windows return latest N in
  order; dedup + command-state roundtrips; broadcast rows update in place.
- **Google Sheets (Phase 7)** — header-driven reads survive column reordering;
  legacy fixed layout still parsed; scientific-notation/whitespace telegram
  ids normalized; `addNewStudent` writes every canonical field;
  **`updateLastMessageSent` performs a real `values.update`** (was a stub);
  eligibility rules verified.
- **Telegram client** — 429 `retry_after` honored then retry; bot-blocked 403
  is permanent (no retries); persistent 500s give up after the retry limit.
- **AI client (Phase 2)** — a retired model id (404) automatically falls
  through the configured fallback chain; transient 500 retries on the same
  model; empty completions are treated as failures.

**Build:** `next build` (Next.js 14.2.35) compiles all four API routes
(`/api/telegram/webhook`, `/api/telegram/setup`, `/api/send-daily`,
`/api/test-send`) cleanly.

**Live end-to-end scenarios** (Phase 9's real-Telegram checklist, items
1–20) require the owner's bot token + two real test accounts after deploying;
the exact script is in the final delivery report. Everything checkable without
those credentials has been checked; nothing unverified is claimed as working.

## 9. Known limitations (honest list)

- **Sheets-backed store scans**: `bot_message_map` lookups read the whole
  (pruned) tab per admin reply — fine at tens of messages/day, upgrade to Redis
  for scale. Eventual consistency of Sheets can rarely delay a fresh
  registration lookup by a second or two.
- **Broadcast duration**: Vercel Hobby caps functions at 60 s; with the 80 ms
  pacing that bounds one broadcast to roughly 600 students
  (`MAX_BROADCAST_BATCH`); larger lists are truncated and reported as skipped.
- **At-most-once processing**: updates are marked processed *before* handling;
  a crash mid-update loses that one update rather than duplicating it. All
  handlers have internal fallbacks so this is rare; the alternative (retry
  storms duplicating AI replies) is worse.
- **Admin trust without allow-list**: with `ADMIN_TELEGRAM_IDS` empty, anyone
  in the private admin group can run admin commands. Set the list.
- **No Vercel/QStash self-requeue** on the Hobby plan: broadcast and daily cron
  are single-invocation batch jobs within the 60 s window.
- Voice notes students send are forwarded to the inbox but the AI does not
  transcribe them (Groq Whisper integration would be the next step).
- Live end-to-end Telegram behaviour (real webhook delivery, real rate limits)
  could not be executed from the sandbox — see the live test checklist in the
  delivery report and run it with two test accounts before going live.

## 10. Rollback instructions

- **Instant (no code rollback):** the webhook is the switch. Unset it to stop
  all automation:
  `curl "https://api.telegram.org/bot<NEW_TOKEN>/deleteWebhook"` — nothing is
  processed while you investigate. Re-set it via `/api/telegram/setup`.
- **Code rollback on Vercel:** Vercel → Deployments → select the last v1
  deployment (pre-upgrade commit `50d66a2`) → "Promote to Production".
  Environment variables added for v2 can stay (v1 ignores unknown ones) — but
  v1 expects `GOOGLE_API_KEY` if you use its daily cron.
- **Git rollback:** `git revert` the upgrade merge commit, or reset `master` to
  `50d66a2` and force-push (coordinate with collaborators).
- **Data rollback:** the new `bot_*` tabs are additive; v1 code never touches
  them. The `students` tab gains at most a `last_message_sent` header/column —
  harmless to v1. No student data is deleted by the upgrade.
