# Shine Bot - AI Student Companion for Shiney Brain Academy

A Telegram bot that sends personalized, AI-generated messages to students daily, keeping them motivated and accountable.

## Features

✅ **Personalized Daily Messages** - AI generates unique messages for each student
✅ **Two-Way Communication** - Students can chat back with the bot
✅ **Smart Message Adaptation** - Tone changes based on exam urgency, inactivity, confidence
✅ **Google Sheets Integration** - Reads student data directly from your sheet
✅ **Groq AI Powered** - Fast, free, open-source LLM
✅ **Telegram Webhook** - Real-time message delivery
✅ **Vercel Cron Jobs** - Automatic daily sends at 8 AM UTC
✅ **Production Ready** - Secure, scalable, tested

## Setup Instructions

### Step 1: Clone/Download This Project
```bash
git clone <repo> shine-bot
cd shine-bot
npm install
```

### Step 2: Set Up Environment Variables
Create `.env.local` file (or update existing):

```
GROQ_API_KEY=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
TELEGRAM_BOT_TOKEN=8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20
GOOGLE_SHEET_ID=1a-cff71_vcxx7FOCmzw53pWPF8Gpp3dBjt0sdn1OhT8
GOOGLE_API_KEY=your_google_api_key_here
CRON_SECRET=shine_secret_xyz_123
```

### Step 3: Get Google API Key (IMPORTANT)
1. Go to https://console.cloud.google.com
2. Create a new project (name: "Shine Bot")
3. Search for "Google Sheets API" → Enable it
4. Go to **Credentials** → **Create Credentials** → **API Key**
5. Copy and paste in `.env.local` as `GOOGLE_API_KEY`

### Step 4: Test Locally
```bash
npm run dev
```

Visit: http://localhost:3000/api/test-send

This will:
- Fetch your first active student from the sheet
- Generate a message using Groq
- Send it via Telegram
- Show success/error response

### Step 5: Deploy to Vercel

#### Option A: Using Vercel CLI (Recommended)
```bash
npm install -g vercel
vercel login
vercel
```

#### Option B: Using GitHub
1. Push code to GitHub
2. Go to https://vercel.com
3. Import repository
4. Add environment variables (from `.env.local`)
5. Deploy

#### Option C: Using Vercel Web Interface
1. Go to https://vercel.com/new
2. Upload project folder
3. Add environment variables
4. Deploy

### Step 6: Set Telegram Webhook
After deployment, run this ONCE in your terminal:

```bash
curl -X POST https://api.telegram.org/bot8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://YOUR_VERCEL_URL.vercel.app/api/telegram/webhook"}'
```

Replace `YOUR_VERCEL_URL` with your actual Vercel domain (e.g., `shine-bot-9jxk.vercel.app`)

Verify it worked:
```bash
curl https://api.telegram.org/bot8894212714:AAEoutlQ_q1I8PXk2hLmlNWm-SJUDTOpd20/getWebhookInfo
```

You should see:
```json
{
  "ok": true,
  "result": {
    "url": "https://YOUR_VERCEL_URL.vercel.app/api/telegram/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Testing

### Test 1: Manual Send via API
```bash
curl https://YOUR_VERCEL_URL.vercel.app/api/test-send
```

### Test 2: Send Daily Messages Manually
```bash
curl -X POST https://YOUR_VERCEL_URL.vercel.app/api/send-daily \
  -H "Authorization: Bearer shine_secret_xyz_123"
```

### Test 3: Talk to Bot on Telegram
1. Open Telegram
2. Find @Coachflorryshinebot
3. Type `/help` to see commands
4. Try `/today`, `/progress`, `/weak`, etc.

## Google Sheet Structure

Your sheet must have these columns (in order):

```
A: name
B: stage
C: exam
D: weak_subjects
E: target_scores
F: skills
G: student_id
H: availability
I: streak
J: last_active
K: joined_date
L: telegram_id
M: exam_date
N: confidence
O: skill_progress
P: status
Q: goals
```

## Automatic Daily Messages

The bot sends messages every day at **8 AM UTC**.

To change the time, edit `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/send-daily",
      "schedule": "0 14 * * *"  // 14 = 2 PM UTC
    }
  ]
}
```

Cron time format: `minute hour * * day_of_week`

## Message Logic

The AI adapts messages based on:
- **Confidence < 5**: Extra encouragement
- **Days Inactive > 3**: Concern + re-engagement
- **Days to Exam < 7**: Urgency
- **High Skill Progress**: Celebration + next challenge
- **Normal State**: Motivation + task

## Troubleshooting

### No messages received?
1. Check `.env.local` variables are correct
2. Verify Google API key has Sheets API enabled
3. Check sheet has students with `status: active`
4. Check Telegram IDs are numbers only (no @)

### Wrong Google columns?
Edit `lib/googleSheets.js` - adjust column indices in the `map()` function

### Groq rate limit?
Groq has generous free tier. If limited, add delays or upgrade.

### Telegram webhook not working?
1. Verify webhook URL is correct (from Vercel)
2. Run the webhook setup command again
3. Check Vercel logs for errors

## Production Checklist

- [ ] Environment variables set in Vercel
- [ ] Google API Key has Sheets API enabled
- [ ] Telegram webhook URL is correct
- [ ] At least 3 test students in sheet with telegram_id
- [ ] Verified cron job in Vercel dashboard
- [ ] Manual test send works
- [ ] Webhook setup command executed
- [ ] Test message received in Telegram

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/send-daily` | POST | Send messages to all active students (Vercel cron calls this) |
| `/api/test-send` | GET | Test send to first active student |
| `/api/telegram/webhook` | POST | Receive and respond to student messages |

## Security Notes

- Store all API keys in `.env.local` (never commit)
- Use `CRON_SECRET` to verify cron requests
- Telegram webhook validates incoming requests
- Google API key can be restricted to Sheets API only

## Files

```
shine-bot/
├── lib/
│   ├── googleSheets.js      (Fetch student data)
│   ├── groqAPI.js           (Generate messages)
│   └── telegramBot.js       (Send messages)
├── pages/api/
│   ├── send-daily.js        (Daily send cron job)
│   ├── test-send.js         (Test endpoint)
│   └── telegram/
│       └── webhook.js       (Receive messages)
├── .env.local               (Environment variables)
├── package.json
├── next.config.js
├── vercel.json
└── README.md
```

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Set webhook
3. 📊 Monitor Telegram bot usage
4. 🔄 Add more students to sheet
5. 💾 Add database (move from Google Sheets)
6. 🎨 Build admin dashboard
7. 📱 Create Shiney Brain mobile app

## Support

Message @Coachflorryshinebot on Telegram for support.

---

**Built with ❤️ for Shiney Brain Academy**
