import { getStudents } from '../../lib/googleSheets';
import { generateShineMessage } from '../../lib/groqAPI';
import { sendMessage } from '../../lib/telegramBot';

export default async function handler(req, res) {
  // Only allow GET for testing (disable in production)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const students = await getStudents();
    
    if (students.length === 0) {
      return res.status(400).json({ error: 'No students found' });
    }

    // Get first active student
    const student = students.find(s => s.status === 'active');
    if (!student) {
      return res.status(400).json({ error: 'No active students found' });
    }

    console.log(`Testing with student: ${student.name}`);

    // Generate message
    const message = await generateShineMessage(student);
    console.log('Generated message:', message);

    // Send message
    await sendMessage(student.telegram_id, message);

    return res.status(200).json({
      success: true,
      student: {
        name: student.name,
        telegram_id: student.telegram_id,
        status: student.status,
      },
      message: message,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error('Test send error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
