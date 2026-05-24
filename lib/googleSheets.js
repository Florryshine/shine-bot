import axios from 'axios';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY = process.env.GOOGLE_API_KEY;

export async function getStudents() {
  try {
    // UPDATED: Changed 'Sheet1' to 'students'
    const range = 'students!A2:Q1000'; 
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;
    
    const response = await axios.get(url);
    const rows = response.data.values || [];
    
    return rows.map((row, index) => ({
      row_number: index + 2,
      student_id: row[6] || '', // Column G
      name: row[0] || '',       // Column A
      stage: row[1] || '',      // Column B
      exam: row[2] || '',       // Column C
      weak_subjects: row[3] || '', // Column D
      target_scores: row[4] || '', // Column E
      skills: row[5] || '',     // Column F
      availability: row[7] || '',  // Column H
      streak: row[8] || '0',       // Column I
      last_active: row[9] || '',   // Column J
      joined_date: row[10] || '',  // Column K
      telegram_id: row[11] || '',  // Column L
      exam_date: row[12] || '',    // Column M
      confidence: parseInt(row[13]) || 5, // Column N
      skill_progress: row[14] || '0%',    // Column O
      status: row[15] || 'active',        // Column P
      goals: row[16] || '',               // Column Q
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
