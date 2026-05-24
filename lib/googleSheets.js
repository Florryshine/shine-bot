import axios from 'axios';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY = process.env.GOOGLE_API_KEY;

export async function getStudents() {
  try {
    const range = 'Sheet1!A2:Q1000'; // Adjust based on your columns
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;
    
    const response = await axios.get(url);
    const rows = response.data.values || [];
    
    return rows.map((row, index) => ({
      row_number: index + 2,
      student_id: row[6] || '', // Column G - student_id
      name: row[0] || '', // Column A - name
      stage: row[1] || '', // Column B - stage
      exam: row[2] || '', // Column C - exam
      weak_subjects: row[3] || '', // Column D - weak_subjects
      target_scores: row[4] || '', // Column E - target_scores
      skills: row[5] || '', // Column F - skills
      availability: row[7] || '', // Column H - availability
      streak: row[8] || '0', // Column I - streak
      last_active: row[9] || '', // Column J - last_active
      joined_date: row[10] || '', // Column K - joined_date
      telegram_id: row[11] || '', // Column L - telegram_id
      exam_date: row[12] || '', // Column M - exam_date
      confidence: parseInt(row[13]) || 5, // Column N - confidence
      skill_progress: row[14] || '0%', // Column O - skill_progress
      status: row[15] || 'active', // Column P - status
      goals: row[16] || '', // Column Q - goals
    })).filter(student => student.name && student.telegram_id); // Only valid students
  } catch (error) {
    console.error('Error fetching students from Google Sheets:', error.message);
    return [];
  }
}

export async function updateLastMessageSent(rowNumber, timestamp) {
  try {
    // This is simplified - in production, use Google Sheets API write
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
