import { getStudents } from '../../lib/googleSheets';
import { generateShineMessage } from '../../lib/groqAPI';
import { sendMessage } from '../../lib/telegramBot';

export default async function handler(req, res) {
  // Verify it's a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Security: verify Vercel cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting daily message send...');
  const startTime = new Date();

  try {
    const students = await getStudents();
    console.log(`Found ${students.length} students`);

    if (students.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No students found',
        processed: 0,
      });
    }

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const student of students) {
      // Skip if status is 'silent'
      if (student.status === 'silent') {
        console.log(`Skipping ${student.name} (silent)`);
        continue;
      }

      try {
        // Generate personalized message
        const message = await generateShineMessage(student);

        // Send via Telegram
        await sendMessage(student.telegram_id, message);

        sent++;
        console.log(`✓ Sent to ${student.name}`);

        // Add delay to avoid rate limits (500ms between messages)
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failed++;
        errors.push({
          student: student.name,
          error: error.message,
        });
        console.error(`✗ Failed for ${student.name}:`, error.message);
      }
    }

    const duration = ((new Date() - startTime) / 1000).toFixed(2);

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
    console.error('Daily send error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date(),
    });
  }
}
