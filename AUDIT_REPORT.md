# SHINE BOT — SYSTEM AUDIT REPORT

**Repo:** `Florryshine/shine-bot` (branch `master`) · **Audited:** 2026-11-23 · **Auditor:** system upgrade engagement, Phase 1

> Scope: full repository audit + live read-only diagnostics against Telegram (`getWebhookInfo`, using the bot token the owner published in the repo docs). Vercel-side checks require the owner's dashboard access and are marked **OWNER-VERIFY**.

---

## 1. Critical security finding (act before anything else)

Seven documentation files committed to the **public GitHub repo** contain live credentials in plain text: `00_READ_ME_FIRST.md`, `DEPLOYMENT_GUIDE.md`, `START_HERE.md`, `QUICKSTART.md`, `PROJECT_STRUCTURE.md`, `INDEX.md`, `VISUAL_SUMMARY.md`.

| Exposed item | Where | Risk | Required action |
|---|---|---|---|
| Telegram bot token (full) | 6 files, incl. inside `curl` URLs | Anyone can take over the bot: read all student messages, send as the bot | **Revoke via @BotFather (`/revoke`) and rotate immediately** |
| Groq API key (full) | 6 files | Anyone can burn the Groq quota / incur cost | **Rotate in console.groq.com, update Vercel env** |
| Google Sheet ID | 7 files | Data exposure if sheet is link/public-shared | Set sheet to private; rotation not applicable, but audit share settings |
| Example `CRON_SECRET` value | 2 files | Owners often reuse the example | Set a real random secret in Vercel |
| Admin group chat ID (hardcoded in `pages/api/telegram/webhook.js:6`) | source | Identifier disclosure | Move to env var (done in this upgrade) |

Removing the files in a new commit does **not** scrub git history. Rotation is mandatory; history rewrite (`git filter-repo`) is optional after rotation. See `SECURITY.md`.

---

## 2. Answers to the twelve audit questions

**Q1. Which Vercel deployment is connected to this repo?** — **OWNER-VERIFY.** Not determinable from the repo or Telegram (see Q2: no webhook is registered, so nothing currently points at any deployment). Check vercel.com → Project → Settings → Git.

**Q2. Which webhook URL is currently active?** — **None.** Live `getWebhookInfo` (2026-11-23) returned `url: ""`, `pending_update_count: 0`. The bot is currently **not receiving any updates at all** — every student message is going unanswered. Last known `allowed_updates` config excludes `callback_query`, which would block inline-button features.

**Q3. Are both previous Vercel projects still active?** — **OWNER-VERIFY.** With no webhook set, neither project is serving Telegram traffic today. Multiple projects sharing one bot token cause the classic "flapping webhook" failure (each deployment's setup step re-points the webhook). Consolidate to one project and delete/pause the other.

**Q4. Which environment variables are configured?** — **OWNER-VERIFY** (Vercel → Settings → Environment Variables). Code requires: `TELEGRAM_BOT_TOKEN`, `GROQ_API_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` (parsed with `JSON.parse` at module load — an unset or malformed value crashes **every** function at import time), plus `GOOGLE_API_KEY` used only by the daily cron.

**Q5. Does deployed code match the repo?** — **OWNER-VERIFY.** Repo has no lockfile; every build re-resolves `^` ranges, so Vercel builds are not reproducible. Verify via Vercel deploy history against commit `50d66a2`.

**Q6. Why is broadcast delivery failing?**
- `broadcastToAllStudents()` (`webhook.js:73`) loops with **zero delay between sends** → Telegram's ~30 msg/s and per-chat 1 msg/s limits produce 429s that are neither detected nor retried.
- No eligibility filtering, no duplicate prevention, no delivery status per student (only aggregate counts), no history.
- Trigger is `text.startsWith('/broadcast ')` — media cannot be broadcast, and any admin-group chatter that merely contains that prefix broadcasts accidentally.
- No admin identity check: **any member** of the admin group can broadcast.

**Q7. Why don't admin group replies reliably reach the student?**
- `handleAdminReply()` (`webhook.js:44`) parses the student's ID out of the formatted HTML of the replied-to message with a regex on `🆔 <b>Telegram ID:</b> <code>(\d+)</code>`.
- It **only works when replying to a student's original message**. AI replies, welcome messages, broadcast confirmations, and any media message carry no such block → `return false` → the bot silently ignores the reply and sends no confirmation. Florry believes the student was answered; the student receives nothing.
- If Telegram returns the text in `caption` or with entities rather than raw HTML, the regex fails even for student messages.
- There is no persistence of who is who: mapping exists only inside message prose.

**Q8. Why are new students' messages not forwarded after registration?**
- The auto-registration branch (`webhook.js:168-182`) registers the student, sends welcome + help, then **returns without ever forwarding the registration message** to the admin group. The very first thing a new student says is invisible to Florry.
- Subsequent messages *are* forwarded, but only if the Sheets write succeeded — `addNewStudent` failures are swallowed (`return false`, no retry), and the student is then re-"registered" on every message.
- Google Sheets append→read is also eventually-consistent in practice; an immediate re-read can miss the new row (no retry/backoff anywhere).

**Q9. Are AI responses forwarded to the admin group?** — **No.** `generateAIReply` output goes only to the student (`webhook.js:224`). Florry never sees what Shine answered, and — combined with Q7 — cannot reply to an AI response at all.

**Q10. Google Sheets column inconsistencies.** Confirmed, and worse than cosmetic:
- `lib/googleSheets.js:getStudents()` reads the **`students`** tab with `name` in **column B**, `telegram_id` in **column M**.
- `pages/api/send-daily.js:getStudentsDirectly()` reads the **`Sheet1`** tab with `name` in **column A**, `telegram_id` in **column L** — a *different tab and a different layout* for the same data. If the real data lives in `students`, the daily cron reads an empty/misaligned `Sheet1` and sends nothing (or garbage).
- `addNewStudent()` appends 13 values whose inline comments (`H streak I last_active`) don't match the actual array positions (streak lands in I, last_active empty at J).
- `updateLastMessageSent()` (`googleSheets.js:75`) is a **stub that only `console.log`s and returns true** — the "last message sent" column is never written by anything, so daily-send deduplication logic (if ever added) has no data.
- No header-row handling anywhere: any column reorder silently corrupts every field.
- Telegram IDs are appended with `USER_ENTERED`; Sheets may coerce long IDs to numbers (locale/scientific-notation hazards). Lookups compare raw strings.

**Q11. Is daily messaging functioning?**
- **OWNER-VERIFY live**, but two latent defects guarantee failure modes: (a) `vercel.json` cron invokes the endpoint with **GET**, while `send-daily.js` returns **405 for anything but POST** — a textbook silent cron failure (check Vercel function logs); (b) the `Sheet1`/`students` schema mismatch in Q10. Messages are also hardcoded templates (docs claim Groq personalization — the code does not do that), there's no 429 handling, and it logs the raw Sheet response to console.

**Q12. Webhook duplication & error-handling problems.**
- **No `update_id` deduplication**: Telegram retries webhooks that don't answer within ~60s or with non-2xx. The handler awaits a Groq call (multi-second) with no `update_id` guard → the same student message can be classified/replied/forwarded multiple times.
- Handler returns **500** on any exception → guaranteed Telegram retry storms on persistent errors.
- **No webhook secret validation**: anyone who discovers the endpoint URL can POST forged Telegram updates (student spoofing: they control `from.id` in a forged update → make the bot send anything anywhere, including to the admin group).
- Module-level `JSON.parse` of service-account creds crashes the whole function on misconfig.
- No media handling: voice notes/photos from students hit the text-only branch and get no reply, no forward.

---

## 3. What works today (preserve, don't rebuild)

Despite the above, the bones are sound and worth keeping exactly as features: auto-registration with welcome + help text; command set (`/start /help /today /progress /weak /chat`); free-text AI conversation; student → admin-group mirroring of plain text messages; replies to a *student's original* admin-group message (works when the regex matches); one-shot `/broadcast <text>`; daily cron shell; bot identity ("Shine", WhatsApp-style Nigerian tone) and Google Sheets as the student record.

## 4. Verdict

The system is **offline right now** (no webhook). The single most fragile dependency is identity-by-message-formatting, and the single most dangerous gap is the unauthenticated webhook + leaked credentials. The upgrade in this repo addresses all twelve findings; implementation notes, schema, and test evidence are in `UPGRADE_NOTES.md`.
