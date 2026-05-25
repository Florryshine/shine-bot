import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

// Parse the JSON string from Vercel
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
      name: row[0] || '',
      telegram_id: row[11] ? row[11].toString().trim() : '',
      student_id: row[6] || '',
      weak_subjects: row[3] || 'General Review',
    })).filter(student => student.name && student.telegram_id);
  } catch (error) {
    console.error('Error fetching students:', error.message);
    return [];
  }
}

export async function addNewStudent(telegram_id, name) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'students!A:L',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[name, 'Active', '', '', '', '', '', '', '0', '', new Date().toISOString().split('T')[0], telegram_id]],
      },
    });
    return true;
  } catch (error) {
    console.error('Error adding new student:', error);
    return false;
  }
}
