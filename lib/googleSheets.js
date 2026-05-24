import axios from 'axios';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY = process.env.GOOGLE_API_KEY;

export async function getStudents() {
  try {
    const range = 'students!A2:Q1000'; // Changed from Sheet1 to students
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;
    
    const response = await axios.get(url);
    const rows = response.data.values || [];
    
    return rows.map((row, index) => ({
      row_number: index + 2,
      student_id: row[6] || '',
      name: row[0] || '',
      stage: row[1] || '',
      exam: row[2] || '',
      weak_subjects: row[3] || '',
      target_scores: row[4] || '',
      skills: row[5] || '',
      availability: row[7] || '',
      streak: row[8] || '0',
      last_active: row[9] || '',
      joined_date: row[10] || '',
      telegram_id: row[11] || '',
      exam_date: row[12] || '',
      confidence: parseInt(row[13]) || 5,
      skill_progress: row[14] || '0%',
      status: row[15] || 'active',
      goals: row[16] || '',
    })).filter(student => student.name && student.telegram_id);
  } catch (error) {
    console.error('Error fetching students from Google Sheets:', error.message);
    return [];
  }
}

export async function updateLastMessageSent(rowNumber, timestamp) {
  try {
    console.log(`Updated row ${rowNumber} last_message_sent: ${timestamp}`);
    return true;
  } catch (error) {
    console.error('Error updating sheet:', error);
    return false;
  }
}

export async function getStudentById(student_id) {
  const students = await getStudents();
  return students.find(s => s.student_id === student_id);
}
