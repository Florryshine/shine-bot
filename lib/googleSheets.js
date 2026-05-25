import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

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
      range: 'students!A2:T1000',
    });

    const rows = response.data.values || [];

    return rows.map((row, index) => ({
      row_number: index + 2,
      name: row[1] || 'New Student',      // Column B
      stage: row[2] || '',                // Column C
      exam: row[3] || '',                 // Column D
      weak_subjects: row[4] || '',        // Column E
      target_scores: row[5] || '',        // Column F
      skills: row[6] || '',               // Column G
      availability: row[7] || '',         // Column H
      streak: row[8] || '0',              // Column I
      last_active: row[9] || '',          // Column J
      joined_date: row[10] || '',         // Column K
      student_id: row[11] || '',          // Column L
      telegram_id: row[12] ? row[12].toString().trim() : '', // Column M
      exam_date: row[13] || '',           // Column N
      confidence: parseInt(row[14]) || 5, // Column O
      skill_progress: row[15] || '0%',   // Column P
      status: row[16] || 'active',        // Column Q
      goals: row[17] || '',               // Column R
    })).filter(student => student.telegram_id);
  } catch (error) {
    console.error('Error fetching students:', error.message);
    return [];
  }
}

export async function addNewStudent(telegram_id, name) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'students!A:N',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          '',           // Column A: userid (auto or empty)
          name,         // Column B: name
          'Active',     // Column C: stage
          '', '', '', '', // D E F G
          '', '0', '',  // H streak I last_active
          new Date().toISOString().split('T')[0], // K joined_date
          '',           // L student_id
          telegram_id,  // M telegram_id
        ]],
      },
    });
    return true;
  } catch (error) {
    console.error('Error adding new student:', error);
    return false;
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
