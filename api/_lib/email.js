const { Resend } = require('resend');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
));

// storno = { lines, notes } aus buildInvoiceData (gleicher Text wie in der PDF)
async function sendInvoiceEmail({ to, invoiceNumber, pdfBuffer, storno }) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const st = storno && (storno.lines.length || storno.notes.length) ? `
      <p style="margin-top:20px"><strong>Stornierung &amp; Umbuchung</strong></p>
      <ul style="padding-left:18px;margin:0 0 8px">${storno.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      <p style="color:#555;font-size:14px">${storno.notes.map(esc).join('<br>')}<br>Es gelten unsere AGB.</p>
  ` : '';

  await resend.emails.send({
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to,
    subject: `Deine Auftragsbestätigung ${invoiceNumber} – TurmX Games`,
    html: `
      <p>Hallo,</p>
      <p>vielen Dank für deine Buchung bei TurmX Games!</p>
      <p>Im Anhang findest du deine verbindliche Auftragsbestätigung <strong>${invoiceNumber}</strong>.</p>
      <p>Deine Rechnung erhältst du nach deinem Event per E-Mail.</p>
      ${st}
      <p>Bei Fragen erreichst du uns jederzeit unter <a href="mailto:games@turmx.de">games@turmx.de</a> oder 0 172 585 00 55.</p>
      <p>Wir freuen uns auf euren Besuch!</p>
      <p>Viele Grüße<br>Euer TurmX Games Team</p>
    `,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}

module.exports = { sendInvoiceEmail };
