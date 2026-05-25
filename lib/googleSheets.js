import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Parse the JSON string from Vercel Environment Variables
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

export async function getStudents() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'students!A2:Q1000',
    });

    const rows = response.data.values || [];
    
    return rows.map((row, index) => ({
      row_number: index + 2,
      name: row[0] || 'New Student',
      stage: row[1] || '',
      exam: row[2] || '',
      weak_subjects: row[3] || '',
      target_scores: row[4] || '',
      skills: row[5] || '',
      student_id: row[6] || '',
      availability: row[7] || '',
      streak: row[8] || '0',
      last_active: row[9] || '',
      joined_date: row[10] || '',
      telegram_id: row[12] ? row[12].toString().trim() : '', 
      exam_date: row[12] || '',
      confidence: parseInt(row[13]) || 5,
      skill_progress: row[14] || '0%',
      status: row[15] || 'active',
      goals: row[16] || '',
    })).filter(student => student.telegram_id); // Keeps only rows that have a Telegram ID
  } catch (error) {
    console.error('Error fetching students:', error.message);
    return [];
  }
}

export async function addNewStudent(telegram_id, name) {
  try {
    // Appends new row to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'students!A:M',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[name, 'Active', '', '', '', '', '', '', '0', '', new Date().toISOString().split('T')[0], '', telegram_id]],
      },
    });
    return true;
  } catch (error) {
    console.error('Error adding new student:', error);
    return false;
  }
      }
