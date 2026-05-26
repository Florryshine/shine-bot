import { sendMessage } from '../../lib/telegramBot';

const motivationalMessages = [
  "🌟 Good morning! Remember, every small step forward is progress. You've got this! 💪",
  "☀️ Rise and shine! Today is a great day to tackle those weak subjects. Let's go! 🚀",
  "💡 New day, new opportunities! Stay focused, stay determined. You're closer to your goals than you think! 🎯",
  "🔥 It's a fresh start! Don't let yesterday's struggles define today. Push forward! 💯",
  "✨ Morning motivation: Consistency beats perfection. One day at a time! 🏆",
  "🌈 You're stronger than your challenges. Keep grinding! 💪",
  "⭐ Today's a perfect day to show yourself what you're made of! Let's do this! 🎓",
];

function getRandomMessage() {
  return motivationalMessages[Math.floor(Math.random() * motivationalMessages.length)];
}

async function getStudentsDirectly() {
  try {
    const SHEET_ID = process.env.GOOGLE_SHEET_ID;
    const API_KEY = process.env.GOOGLE_API_KEY;
    
    console.log('Fetching from Google Sheets directly...');
    console.log('Sheet ID:', SHEET_ID);
    
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Sheet1!A2:T1000?key=${API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('Raw response:', data);
    
    if (!data.values) {
      console.log('No values found in sheet');
      return [];
    }

    const rows = data.values;
    const students = rows.map((row, index) => ({
      row_number: index + 2,
      name: row[0] || 'Unknown',
      stage: row[1] || '',
      exam: row[2] || '',
      weak_subjects: row[3] || '',
      target_scores: row[4] || '',
      skills: row[5] || '',
      student_id: row[6] || '',
      availability: row[7] || '',
      streak: row[8] || '',
      last_active: row[9] || '',
      joined_date: row[10] || '',
      telegram_id: row[11] || '',
      exam_date: row[12] || '',
      confidence: row[13] || '',
      skill_progress: row[14] || '',
      status: row[15] || 'active',
      goals: row[16] || '',
    }));

    console.log(`Parsed ${students.length} students`);
    return students;
  } catch (error) {
    console.error('Error fetching students directly:', error.message);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('===== DAILY MESSAGE CRON JOB STARTED =====');
  console.log('Time:', new Date().toISOString());

  const startTime = new Date();

  try {
    console.log('Fetching students from Google Sheets...');
    const students = await getStudentsDirectly();
    console.log(`✅ Found ${students.length} students`);

    if (students.length === 0) {
      console.log('⚠️ No students found');
      return res.status(200).json({
        success: true,
        message: 'No students found',
        processed: 0,
        timestamp: new Date(),
      });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const student of students) {
      // Skip if status is 'silent'
      if (student.status === 'silent') {
        console.log(`⏭️  Skipping ${student.name} (status: silent)`);
        continue;
      }

      try {
        console.log(`📤 Sending to ${student.name} (ID: ${student.telegram_id})...`);

        // Get a random motivational message
        const motivationalMsg = getRandomMessage();
        
        // Format with student name
        const message = `
${motivationalMsg}

Your current focus: <b>${student.weak_subjects || 'General Review'}</b>
Target score: <b>${student.target_scores || 'Not set'}</b>

Keep pushing! 🌟
        `;

        // Send via Telegram
        await sendMessage(student.telegram_id, message);

        sent++;
        console.log(`✅ Sent to ${student.name}`);

        // Add delay to avoid rate limits (500ms between messages)
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failed++;
        const errorMsg = error.message || 'Unknown error';
        errors.push({
          student: student.name,
          telegram_id: student.telegram_id,
          error: errorMsg,
        });
        console.error(`❌ Failed for ${student.name}:`, errorMsg);
      }
    }

    const duration = ((new Date() - startTime) / 1000).toFixed(2);

    console.log('===== DAILY MESSAGE CRON JOB COMPLETED =====');
    console.log(`Duration: ${duration}s`);
    console.log(`Sent: ${sent}, Failed: ${failed}`);

    return res.status(200).json({
      success: true,
      processed: students.length,
      sent: sent,
      failed: failed,
      duration: `${duration}s`,
      timestamp: new Date(),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('===== DAILY SEND ERROR =====');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);

    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      timestamp: new Date(),
    });
  }
}
