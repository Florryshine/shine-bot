# ⚡ SHINE BOT - QUICK START (30 MIN TO LIVE)

## YOUR CREDENTIALS (SAVED)
```
✅ Groq API: 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
✅ Telegram Token: 8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20
✅ Sheet ID: 1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8
⏳ Google API Key: NEED TO GET (3 min)
```

---

## ☑️ CHECKLIST (DO THESE NOW)

### PART 1: GET GOOGLE API KEY (3 MIN)

- [ ] Go to https://console.cloud.google.com
- [ ] Create new project (name: "Shine Bot")
- [ ] Search: "Google Sheets API" → Enable
- [ ] Go to Credentials → Create API Key
- [ ] Copy the key
- [ ] Open `.env.local` file
- [ ] Replace `your_google_api_key_here` with your key
- [ ] Save file

**Test it:** 
```
https://sheets.googleapis.com/v4/spreadsheets/1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8/values/Sheet1?key=YOUR_KEY
```

Should show your student data.

---

### PART 2: DOWNLOAD & SETUP (5 MIN)

- [ ] Download all files (they're in `/mnt/user-data/outputs/`)
- [ ] Create folder: `shine-bot`
- [ ] Put all files in folder (keep structure)
- [ ] Create `lib/` subfolder
- [ ] Create `pages/api/telegram/` subfolders
- [ ] Copy files to correct folders

Folder structure should look like:
```
shine-bot/
├── lib/
│   ├── googleSheets.js
│   ├── groqAPI.js
│   └── telegramBot.js
├── pages/api/
│   ├── send-daily.js
│   ├── test-send.js
│   └── telegram/webhook.js
├── .env.local
├── package.json
├── next.config.js
├── vercel.json
├── README.md
└── ... other files
```

- [ ] Open terminal in `shine-bot` folder
- [ ] Run: `npm install`

---

### PART 3: TEST LOCALLY (5 MIN)

- [ ] Terminal: `npm run dev`
- [ ] Wait for: "ready - started server on 0.0.0.0:3000"
- [ ] Open: http://localhost:3000/api/test-send
- [ ] Check response (should say "success": true)
- [ ] Check Telegram - you should receive a message!

If no message:
- [ ] Verify telegram_id in sheet (should be number only)
- [ ] Check Groq API key in `.env.local`
- [ ] Check Google API key works
- [ ] Try again

If yes message → You're ready to deploy! ✅

---

### PART 4: DEPLOY TO VERCEL (10 MIN)

**Option A: CLI (Easiest)**
- [ ] Terminal: `npm install -g vercel`
- [ ] Terminal: `vercel login`
- [ ] Terminal: `vercel`
- [ ] Follow prompts (press Enter for defaults)
- [ ] Wait for deployment
- [ ] You'll get a URL like: `https://shine-bot-9jxk.vercel.app`
- [ ] Save this URL

**Option B: GitHub Web**
- [ ] Push code to GitHub
- [ ] Go to https://vercel.com/new
- [ ] Import your repo
- [ ] Add environment variables (same as `.env.local`)
- [ ] Click Deploy
- [ ] Wait for deployment
- [ ] Save your URL

---

### PART 5: SET TELEGRAM WEBHOOK (2 MIN)

This is CRITICAL.

- [ ] Open terminal
- [ ] Replace `YOUR_VERCEL_URL` with your actual URL (from Step 4)
- [ ] Run this command:

```bash
curl -X POST https://api.telegram.org/bot8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://YOUR_VERCEL_URL/api/telegram/webhook"}'
```

Example with real URL:
```bash
curl -X POST https://api.telegram.org/bot8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://shine-bot-9jxk.vercel.app/api/telegram/webhook"}'
```

- [ ] You should see: `{"ok":true,"result":true,"description":"Webhook was set"}`

---

### PART 6: VERIFY LIVE (3 MIN)

- [ ] Test manual send: `curl https://YOUR_VERCEL_URL/api/test-send`
- [ ] Check Telegram - message should arrive
- [ ] Open Telegram bot: @Coachflorryshinebot
- [ ] Send: `/help`
- [ ] Bot should reply with menu
- [ ] Try: `/today`
- [ ] Try: `/progress`

---

## 🎉 YOU'RE LIVE!

Your Shine Bot is now:
- ✅ Running on Vercel (24/7)
- ✅ Sending daily messages at 8 AM UTC
- ✅ Responding to student commands
- ✅ Reading from your Google Sheet
- ✅ Using Groq AI for personalization

---

## WHAT HAPPENS DAILY

Every day at 8 AM UTC:
1. Vercel cron calls `/api/send-daily`
2. Bot fetches all students from your Google Sheet
3. For each active student:
   - Generates personalized message using Groq
   - Sends to their Telegram
4. Returns success count
5. Repeats tomorrow

---

## IF SOMETHING BREAKS

**No message received?**
```
1. Check .env.local has correct keys
2. Verify Google API key has Sheets API enabled
3. Check sheet has students with status: active
4. Check telegram_id is number only (no @)
5. Run /api/test-send again
```

**Telegram not responding?**
```
1. Verify webhook was set (run curl command again)
2. Check Vercel logs for errors
3. Try sending /help to bot
```

**Cron not running?**
```
1. Check Vercel dashboard > Crons tab
2. Verify vercel.json exists and has correct format
3. Redeploy: vercel --prod
```

---

## NEXT STEPS (AFTER LIVE)

1. Add more students to your Google Sheet
2. Change daily time (edit vercel.json if 8 AM doesn't work)
3. Build admin dashboard
4. Add database (Supabase/PostgreSQL)
5. Create Shiney Brain mobile app

---

## IMPORTANT NOTES

- Don't commit `.env.local` to GitHub
- Keep API keys secret
- If keys are exposed, regenerate them immediately
- Google API key can be restricted to Sheets API only
- Groq has free tier with generous limits

---

## YOUR NEXT ACTIONS (IN ORDER)

```
1. Get Google API Key (3 min)
2. Download files (1 min)
3. Setup folders (2 min)
4. npm install (3 min)
5. npm run dev (1 min)
6. Test locally (2 min)
7. Deploy to Vercel (10 min)
8. Set webhook (2 min)
9. Verify live (3 min)
```

**Total: ~30 minutes from start to live**

---

## YOU HAVE ALL THE CODE

Everything you need is in these files:
- ✅ googleSheets.js
- ✅ groqAPI.js
- ✅ telegramBot.js
- ✅ send-daily.js
- ✅ test-send.js
- ✅ webhook.js
- ✅ package.json
- ✅ .env.local
- ✅ vercel.json
- ✅ All configs

**No more missing pieces. Just copy-paste and deploy.**

---

## TROUBLESHOOTING LINKS

- Vercel Docs: https://vercel.com/docs
- Google Sheets API: https://developers.google.com/sheets
- Groq Console: https://console.groq.com
- Telegram Bot API: https://core.telegram.org/bots/api

---

**START NOW. You've got 30 minutes to be live.**

Message me when you hit any blockers.

---

*Built with ❤️ for Shiney Brain Academy*
