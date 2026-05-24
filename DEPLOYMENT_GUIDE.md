# SHINE BOT - COMPLETE DEPLOYMENT GUIDE

## YOUR CREDENTIALS (ALREADY SET)

```
✅ Groq API Key: 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
✅ Telegram Bot Token: 8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20
✅ Google Sheet ID: 1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8
⏳ Google API Key: STILL NEEDED (Step 1)
```

---

## STEP-BY-STEP DEPLOYMENT (30 MINUTES)

### STEP 1: GET GOOGLE API KEY (5 MIN)

**Why:** So the bot can read your student data from Google Sheets.

1. Go to: https://console.cloud.google.com
2. Click "Create Project" (top left)
3. Name it: `Shine Bot`
4. Click "Create"
5. Wait for it to load (2-3 seconds)
6. Search for: `Google Sheets API`
7. Click it → Click "Enable"
8. Click "Create Credentials" (blue button)
9. Choose: **API Key**
10. Copy the key (looks like: `AIza...`)
11. Go back to `.env.local` and paste it as `GOOGLE_API_KEY`

**Test it worked:** 
```
Can you access https://sheets.googleapis.com/v4/spreadsheets/1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8/values/Sheet1?key=YOUR_KEY
```

If you see your student data, ✅ it works!

---

### STEP 2: PREPARE PROJECT FOLDER (2 MIN)

**Windows:**
```bash
git clone https://github.com/yourname/shine-bot.git
cd shine-bot
```

**Or manually:**
1. Download the files I created
2. Put them in a folder named `shine-bot`
3. Open terminal in that folder

---

### STEP 3: INSTALL DEPENDENCIES (3 MIN)

```bash
npm install
```

Wait for it to finish (it's normal if it takes a minute).

---

### STEP 4: TEST LOCALLY (5 MIN)

```bash
npm run dev
```

You should see:
```
> ready - started server on 0.0.0.0:3000
```

Now open: http://localhost:3000/api/test-send

You should get a response like:
```json
{
  "success": true,
  "student": {
    "name": "Amina",
    "telegram_id": "987654321",
    "status": "active"
  },
  "message": "Hey Amina! Let's focus on Physics today...",
  "timestamp": "2024-05-24T..."
}
```

**And you should receive a Telegram message!**

If you didn't get the message:
- Check your Telegram bot username is correct
- Check your student's telegram_id matches your ID
- Check Groq API key is correct

Once you get a test message, you're ready to deploy.

---

### STEP 5: DEPLOY TO VERCEL (10 MIN)

#### Option A: Easiest - Vercel CLI

```bash
npm install -g vercel
vercel login
vercel
```

Follow the prompts. When it asks about settings, just press Enter to accept defaults.

It will give you a URL like: `https://shine-bot-9jxk.vercel.app`

#### Option B: GitHub + Vercel Web

1. Push code to GitHub
2. Go to https://vercel.com/new
3. Import your repo
4. Add these environment variables:
   ```
   GROQ_API_KEY = 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
   TELEGRAM_BOT_TOKEN = 8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20
   GOOGLE_SHEET_ID = 1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8
   GOOGLE_API_KEY = YOUR_KEY_HERE
   CRON_SECRET = shine_secret_xyz_123
   ```
5. Click Deploy

Wait for deployment to finish. You'll get a URL.

---

### STEP 6: SET TELEGRAM WEBHOOK (2 MIN)

This is CRITICAL - it tells Telegram to send updates to your bot.

Open your terminal and run:

```bash
curl -X POST https://api.telegram.org/bot8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://YOUR_VERCEL_URL.vercel.app/api/telegram/webhook"}'
```

**Replace:** `YOUR_VERCEL_URL` with your actual Vercel URL (e.g., `shine-bot-9jxk`)

You should get:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

If something is wrong, you'll see an error.

---

### STEP 7: VERIFY EVERYTHING WORKS (3 MIN)

#### Test 1: Manual Send
```bash
curl https://YOUR_VERCEL_URL.vercel.app/api/test-send
```

You should get a message in Telegram.

#### Test 2: Talk to Bot
1. Open Telegram
2. Find @Coachflorryshinebot
3. Type: `/help`

Bot should reply with commands.

#### Test 3: Automatic Cron
Check your Vercel dashboard:
1. Go to https://vercel.com
2. Select your project
3. Go to "Crons"
4. You should see one job: `/api/send-daily` at 8 AM

---

## WHAT HAPPENS NOW

✅ **Every day at 8 AM UTC**, your bot automatically:
1. Fetches all students from your Google Sheet
2. Generates personalized messages using Groq AI
3. Sends them via Telegram

✅ **Students can reply** to messages, and the bot responds with help

✅ **No manual work** - it's fully automated

---

## TROUBLESHOOTING

### "No module named groq"
```bash
npm install groq-sdk
```

### "Cannot read Google Sheets"
- Verify Google API key is correct
- Check it has Sheets API enabled
- Try the test link from Step 1

### "Telegram message not received"
- Check telegram_id in sheet (should be numbers only)
- Verify bot token is correct
- Run `/setWebhook` again

### "502 Bad Gateway on Vercel"
- Wait 30 seconds and try again
- Check environment variables are set
- Check logs in Vercel dashboard

### "Cron job not running"
- Verify `vercel.json` exists
- Check Vercel dashboard under "Crons"
- It only runs if you've deployed the file

---

## NEXT STEPS

Once everything is working:

1. **Add more students** to your Google Sheet
2. **Change cron time** if 8 AM doesn't work for you (edit `vercel.json`)
3. **Build admin dashboard** to manage students
4. **Add database** (move from Google Sheets to real DB)
5. **Expand features** (quizzes, progress tracking, etc.)

---

## QUICK REFERENCE

| What | How | Where |
|------|-----|-------|
| Change send time | Edit `vercel.json` | Line 5: `"schedule": "0 8 * * *"` |
| Add students | Add rows to Google Sheet | Column A: name, Column L: telegram_id |
| Disable a student | Set status to `silent` | Column P |
| Test send | `curl https://YOUR_URL/api/test-send` | Terminal |
| View logs | Vercel dashboard → Functions | https://vercel.com |
| Change message tone | Edit `lib/groqAPI.js` | Search for "tone = " |

---

## YOU'RE ALL SET! 🚀

Your Shine Bot is now:
- ✅ Live on Vercel
- ✅ Sending personalized AI messages daily
- ✅ Receiving student replies
- ✅ Running 24/7 without your laptop

Now go add more students and watch engagement explode!

Message @Coachflorryshinebot to test it out.

---

**Questions?** Check README.md or reply with errors.
