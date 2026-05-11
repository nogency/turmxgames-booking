const { google } = require('googleapis');
const { Readable } = require('stream');

/**
 * Lädt eine Rechnung als PDF in den konfigurierten Google Drive Ordner hoch.
 * Fire-and-forget — Fehler werden nur geloggt, nie nach oben weitergegeben.
 */
async function uploadInvoiceToDrive(pdfBuffer, filename) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const folderId           = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!serviceAccountJson || !folderId) {
    console.warn('[Drive] Env vars fehlen — Upload übersprungen');
    return;
  }

  const credentials = JSON.parse(serviceAccountJson);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  const drive = google.drive({ version: 'v3', auth });

  // Buffer → lesbarer Stream
  const stream = Readable.from(pdfBuffer);

  const response = await drive.files.create({
    requestBody: {
      name:    filename,
      parents: [folderId],
      mimeType: 'application/pdf',
    },
    media: {
      mimeType: 'application/pdf',
      body:     stream,
    },
    fields: 'id, name',
  });

  console.log(`[Drive] Hochgeladen: ${response.data.name} (${response.data.id})`);
  return response.data;
}

module.exports = { uploadInvoiceToDrive };
