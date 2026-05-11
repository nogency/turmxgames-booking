const { Storage } = require('@google-cloud/storage');

/**
 * Lädt eine Rechnung als PDF in den Google Cloud Storage Bucket hoch.
 * Fire-and-forget — Fehler werden nur geloggt, nie nach oben weitergegeben.
 */
async function uploadInvoiceToDrive(pdfBuffer, filename) {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const bucketName         = process.env.GCS_BUCKET_NAME;

  if (!serviceAccountJson || !bucketName) {
    console.warn('[GCS] Env vars fehlen — Upload übersprungen');
    return;
  }

  const credentials = JSON.parse(serviceAccountJson);

  const storage = new Storage({ credentials, projectId: credentials.project_id });
  const bucket  = storage.bucket(bucketName);
  const file    = bucket.file(filename);

  await file.save(pdfBuffer, {
    contentType: 'application/pdf',
    resumable:   false,
  });

  console.log(`[GCS] Hochgeladen: ${filename} → gs://${bucketName}/${filename}`);
}

module.exports = { uploadInvoiceToDrive };
