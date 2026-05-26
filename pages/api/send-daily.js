import { getStudents } from '../../lib/googleSheets';
import { generateShineMessage } from '../../lib/groqAPI';
import { sendMessage } from '../../lib/telegramBot';

export default async function handler(req, res) {
  // Verify it's a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('===== DAILY MESSAGE CRON JOB STARTED =====');
  console.log('Time:', new Date().toISOString());
  console.log('Headers:', req.headers);

  // Security: verify Vercel cron secret (optional - only if you set it)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, verify it. Otherwise allow it.
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.log('❌ Unauthorized: Invalid cron secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('✅ Authorization passed');

  const startTime = new Date();

  try {
    console.log('Fetching students from Google Sheets...');
    const students = await getStudents();
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

        // Generate personalized message
        const message = await generateShineMessage(student);

        // Send via Telegram
        await sendMessage(student.telegram_id, message);

        sent++;
        console.log(`✅ Sent to ${student.name}`);

        // Add delay to avoid rate limits (500ms between messages)
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failed++;
        const errorMsg = error.message || JSON.stringify(error);
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
