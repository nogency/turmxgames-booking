const { Redis }  = require('@upstash/redis');
const { Resend } = require('resend');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = process.env.ADMIN_SECRET;
  const auth   = req.headers['authorization'] || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  const redis = new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  const raw = await redis.get(`bl:${id}`);
  if (!raw) return res.status(404).json({ error: 'Link nicht gefunden oder abgelaufen' });

  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const bookingUrl = `https://booking.turmxgames.de/?b=${id}`;

  const dateFmt = d.date
    ? new Date(d.date + 'T12:00:00').toLocaleDateString('de-DE', {
        weekday:'long', day:'2-digit', month:'long', year:'numeric'
      })
    : d.date;

  const extras = [];
  if (d.drinksFlat) extras.push('Getränkeflat');
  if (d.insurance)  extras.push('Flex-Versicherung');
  if (d.freefall)   extras.push('Freefall Mutprobe');

  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.INVOICE_FROM_EMAIL || 'buchung@mail.turmxgames.de',
    to:   d.email,
    subject: `🎯 Deine TurmX Buchung — Jetzt bezahlen`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C0392B;padding:24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:22px;letter-spacing:1px">DEINE TURMX BUCHUNG</h2>
          <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px">Vorbereitet vom TurmX Team · Nur noch bezahlen!</p>
        </div>
        <div style="background:#f9f8f6;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e8e5e0;border-top:none">
          <p style="font-size:14px;line-height:1.7;color:#444;margin-bottom:20px">
            Hallo ${d.firstName},<br><br>
            wir haben deine Buchung bereits vorbereitet. Klick einfach auf den Button, überprüfe die Zusammenfassung und bezahle — fertig!
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px">
            <tr style="border-bottom:1px solid #e8e5e0">
              <td style="padding:9px 0;color:#888;width:140px">Event</td>
              <td style="padding:9px 0;font-weight:600">${d.eventName || d.eventKey}</td>
            </tr>
            <tr style="border-bottom:1px solid #e8e5e0">
              <td style="padding:9px 0;color:#888">Datum &amp; Zeit</td>
              <td style="padding:9px 0">${dateFmt} · ${d.time} Uhr</td>
            </tr>
            <tr style="border-bottom:1px solid #e8e5e0">
              <td style="padding:9px 0;color:#888">Personen</td>
              <td style="padding:9px 0;font-weight:600">${d.groupSize} Personen</td>
            </tr>
            ${extras.length ? `
            <tr>
              <td style="padding:9px 0;color:#888;vertical-align:top">Extras</td>
              <td style="padding:9px 0">${extras.join(' · ')}</td>
            </tr>` : ''}
          </table>
          <div style="text-align:center;margin-bottom:20px">
            <a href="${bookingUrl}"
               style="display:inline-block;background:#C0392B;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-size:17px;font-weight:700;letter-spacing:1px">
              JETZT VERBINDLICH BUCHEN →
            </a>
          </div>
          <p style="font-size:11px;color:#aaa;text-align:center;line-height:1.6">
            Dieser Link ist persönlich für dich erstellt worden.<br>
            Fragen? <a href="tel:01725850055" style="color:#C0392B">0172 585 00 55</a>
          </p>
        </div>
      </div>
    `,
  });

  return res.status(200).json({ success: true });
};
