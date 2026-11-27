# LIVE TEST PLAN — run with real Telegram test accounts after deploying

Setup: two Telegram test accounts (A = student, B = second student), your own
account as Florry, the bot added as admin to the private admin group, all env
vars set, webhook registered via `/api/telegram/setup`.

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | New student registration | From account A, send any message to the bot | Welcome + help menu; A registered in `students` tab; **A's first message is mirrored to the admin group** |
| 2 | Returning student greeting | A sends "hi" | AI greets by name; mirrored 🟢 |
| 3 | Biology explanation | A: "explain mitosis" | Step-by-step tutor answer with self-check question; mirrored 🟢 |
| 4 | Chemistry question | A: "what is electrolysis?" | Tutor answer; mirrored 🟢 |
| 5 | Motivation | A: "motivate me" | Short personalised motivation; mirrored 🟢 |
| 6 | Emotional distress | A: "I feel depressed and hopeless about everything" | Warm ack that Florry was notified; 🟠 tag + "Awaiting Florry" in group; no generic motivational essay |
| 7 | Physical health | A: "I've been having chest pains and feeling weak" | ORANGE handling as above |
| 8 | Serious personal issue | A: "my parents are fighting every day, I can't study" | ORANGE handling as above |
| 9 | Explicit request | A: "can I talk to Florry?" | ORANGE (fast path), ack + inbox mirror |
| 10 | Florry replies to student | In admin group, swipe-reply to A's mirrored message with text | A receives "📩 Coach Florryshine: …" in private chat; ✅ confirmation in group |
| 11 | Florry replies to an AI response | Reply to one of Shine's mirrored 🟢 replies | A receives it; confirmation in group |
| 12 | Simultaneous students | A and B message within the same second | Both answered independently; no cross-talk |
| 13 | Broadcast text | `/broadcast` → type text → CONFIRM | Preview with buttons; delivery to eligible students; report "Delivered: N"; history row |
| 14 | Broadcast voice note | `/broadcast` → send a voice note → CONFIRM | Voice delivered via sendVoice with caption |
| 15 | Broadcast document | `/broadcast` → attach a PDF → CONFIRM | Document delivered |
| 16 | Broadcast cancellation | `/broadcast` → content → CANCEL (button and /cancel variants) | Nothing sent; state cleared |
| 17 | Rate-limit behaviour | Broadcast to many students (or set BROADCAST_SEND_DELAY_MS high) | 429s retried with retry_after; report shows any permanent failures |
| 18 | Duplicate webhook update | Re-post the same captured update JSON to the webhook URL (with secret header) | `{"duplicate": true}`; no second reply |
| 19 | New student second message | After registration, A sends another message | Normal pipeline (no second welcome); mirrored; answered |
| 20 | Unauthorized admin attempt | From an account that is NOT in ADMIN_TELEGRAM_IDS (but in the group), send `/broadcast hi` | Rejected; broadcast engine not started |

**Privacy regression check (run after 10–12):** verify from account B's device
that no message containing A's reply appears, and vice versa. The offline test
`tests/webhook.test.mjs` asserts this at the logic level; this live check
confirms the real wiring.

**Negative security checks:** POST to the webhook URL without the secret
header → expect 401 and no visible action; call `/api/test-send` without
`x-admin-secret` → 401.
