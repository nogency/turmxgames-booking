const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone, groupSize, eventType, desiredDate, message } = req.body || {};

  if (!name || !email || !groupSize) {
    return res.status(400).json({ error: 'name, email, groupSize required' });
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: process.env.INVOICE_FROM_EMAIL || 'buchung@mail.turmxgames.de',
      to:   process.env.INQUIRY_EMAIL || 'games@turmx.de',
      replyTo: email,
      subject: `🎯 Großgruppen-Anfrage: ${name} · ${groupSize} Personen`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
          <div style="background:#C0392B;padding:20px 24px;border-radius:8px 8px 0 0">
            <h2 style="color:#fff;margin:0;font-size:20px;letter-spacing:1px">GROSSGRUPPEN-ANFRAGE</h2>
            <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">Über das Buchungstool · booking.turmxgames.de</p>
          </div>
          <div style="background:#f9f8f6;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e8e5e0;border-top:none">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <tr><td style="padding:7px 0;color:#888;width:140px">Name</td><td style="padding:7px 0;font-weight:600">${name}</td></tr>
              <tr><td style="padding:7px 0;color:#888">E-Mail</td><td style="padding:7px 0"><a href="mailto:${email}" style="color:#C0392B">${email}</a></td></tr>
              ${phone ? `<tr><td style="padding:7px 0;color:#888">Telefon</td><td style="padding:7px 0">${phone}</td></tr>` : ''}
              <tr><td style="padding:7px 0;color:#888">Personenanzahl</td><td style="padding:7px 0;font-size:18px;font-weight:700;color:#C0392B">${groupSize} Personen</td></tr>
              ${eventType ? `<tr><td style="padding:7px 0;color:#888">Event-Art</td><td style="padding:7px 0">${eventType}</td></tr>` : ''}
              ${desiredDate ? `<tr><td style="padding:7px 0;color:#888">Wunschdatum</td><td style="padding:7px 0">${desiredDate}</td></tr>` : ''}
              ${message ? `<tr><td style="padding:7px 0;color:#888;vertical-align:top">Nachricht</td><td style="padding:7px 0">${message}</td></tr>` : ''}
            </table>
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e8e5e0">
              <a href="mailto:${email}?subject=Ihr Angebot TurmX Games – ${groupSize} Personen"
                 style="display:inline-block;background:#C0392B;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:1px">
                DIREKT ANTWORTEN
              </a>
            </div>
          </div>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[Inquiry Error]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
