const { Resend } = require('resend');

async function sendInvoiceEmail({ to, invoiceNumber, pdfBuffer }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to,
    subject: `Ihre Rechnung ${invoiceNumber} – TurmX Games`,
    html: `
      <p>Hallo,</p>
      <p>vielen Dank für Ihre Buchung bei TurmX Games!</p>
      <p>Im Anhang finden Sie Ihre Rechnung <strong>${invoiceNumber}</strong>.</p>
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
