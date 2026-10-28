/**
 * Vercel Serverless Function — Gutschein-Verkauf
 *
 * Eigenständiger Endpoint, bewusst getrennt von api/bookla.js:
 * Der Buchungs-Checkout bleibt unberührt.
 *
 * Actions:
 *   create-payment  → Betrag SERVERSEITIG berechnen, Stripe PaymentIntent
 *   finalize        → Zahlung verifizieren → Bookla-Promo-Code (single_use)
 *                     anlegen → PDF erzeugen → Mails versenden
 *
 * Sicherheitsmodell: Ein Gutschein-Code IST Geld. finalize erzeugt den Code
 * erst, nachdem die Zahlung bei Stripe/PayPal serverseitig verifiziert wurde
 * (Status + Betrag aus der Zahlungsquelle, nie aus dem Request-Body).
 */

const { generateGiftcardPDF } = require('./_lib/giftcard-pdf');
const { uploadInvoiceToDrive } = require('./_lib/drive');

const BOOKLA_BASE = 'https://eu.bookla.com/api/v1';
// PayPal: Live wie bisher; für Vorschau/Test per PAYPAL_API_BASE=https://api-m.sandbox.paypal.com
const PAYPAL_API = process.env.PAYPAL_API_BASE || 'https://api-m.paypal.com';

const MIN_EUR = 10;
const MAX_EUR = 500;
const SHIPPING_EUR = 2.95;
const VALID_YEARS = 3;

// ── Helpers ────────────────────────────────────────────────────────────────

function generateCode() {
  // GS-XXXX-XXXX, ohne verwechselbare Zeichen (0/O/1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const block = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `GS-${block()}-${block()}`;
}

async function booklaFetch(path, method, body, apiKey) {
  const resp = await fetch(`${BOOKLA_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    ...(body && { body: JSON.stringify(body) }),
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!resp.ok) {
    const err = new Error(data?.message || `Bookla ${resp.status}`);
    err.status = resp.status; err.details = data; throw err;
  }
  return data;
}

async function getPaypalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret   = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) throw new Error('PayPal credentials not configured');
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');
  const res  = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method:  'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal token error: ${data.error_description || res.status}`);
  return data.access_token;
}

async function getPaypalAuthorization(authorizationId) {
  const token = await getPaypalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v2/payments/authorizations/${authorizationId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth lookup failed: ${data.message || res.status}`);
  return data;
}

async function capturePaypalAuth(authorizationId) {
  const token = await getPaypalAccessToken();
  const res = await fetch(`${PAYPAL_API}/v2/payments/authorizations/${authorizationId}/capture`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal capture failed: ${data.message || res.status}`);
  return data;
}

function fmtEur(n) { return n.toFixed(2).replace('.', ',') + ' €'; }

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ── Handler ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.query;

  try {
    switch (action) {

      // ─────────────────────────────────────────────
      // 1. Zahlung anlegen — Betrag wird HIER berechnet,
      //    der Client liefert nur Wunschbetrag + Typ.
      // ─────────────────────────────────────────────
      case 'create-payment': {
        const { amount, type } = req.body || {};
        const eur = Math.round(parseFloat(amount) * 100) / 100;

        if (!Number.isFinite(eur) || eur < MIN_EUR || eur > MAX_EUR) {
          return res.status(400).json({ error: `Betrag muss zwischen ${MIN_EUR} € und ${MAX_EUR} € liegen.` });
        }
        if (type !== 'digital' && type !== 'hardcopy') {
          return res.status(400).json({ error: 'Ungültiger Gutschein-Typ.' });
        }

        const totalEur    = type === 'hardcopy' ? Math.round((eur + SHIPPING_EUR) * 100) / 100 : eur;
        const stripe      = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const paymentIntent = await stripe.paymentIntents.create({
          amount:   Math.round(totalEur * 100),
          currency: 'eur',
          description: `TurmX Games Gutschein ${fmtEur(eur)} (${type === 'hardcopy' ? 'Hardcopy' : 'Digital'})`,
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind:            'giftcard',
            giftAmountCents: String(Math.round(eur * 100)),
            giftType:        type,
          },
        });

        return res.status(200).json({
          clientSecret:    paymentIntent.client_secret,
          paymentIntentId: paymentIntent.id,
          total:           totalEur,
        });
      }

      // ─────────────────────────────────────────────
      // 2. Nach Zahlung: verifizieren → Code anlegen →
      //    PDF + Mails. Idempotent pro Zahlung.
      // ─────────────────────────────────────────────
      case 'finalize': {
        const { paymentIntentId, paypalAuthId, type, buyer, shipping } = req.body || {};

        if (!paymentIntentId && !paypalAuthId) {
          return res.status(400).json({ error: 'Zahlungsreferenz fehlt.' });
        }
        if (!buyer?.email || !/\S+@\S+\.\S+/.test(buyer.email)) {
          return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich.' });
        }

        const apiKey    = process.env.BOOKLA_API_KEY;
        const companyId = process.env.BOOKLA_COMPANY_ID;
        if (!apiKey || !companyId) {
          return res.status(500).json({ error: 'Bookla credentials not configured' });
        }

        // ── Zahlung serverseitig verifizieren — Betrag/Typ aus der
        //    Zahlungsquelle, NIE aus dem Request-Body ──
        let giftEur = null;
        let giftType = null;
        let payRef = null;
        let authStatus = null;

        if (paymentIntentId) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          if (pi.metadata?.kind !== 'giftcard') {
            return res.status(400).json({ error: 'Zahlung gehört zu keinem Gutschein.' });
          }
          if (pi.status !== 'succeeded') {
            return res.status(402).json({ error: 'Zahlung ist nicht abgeschlossen.' });
          }
          giftEur  = parseInt(pi.metadata.giftAmountCents, 10) / 100;
          giftType = pi.metadata.giftType;
          // Dauerhafte Zweitsicherung: Für diese Zahlung gibt es schon einen Gutschein (steht an der Zahlung selbst)
          if (pi.metadata.giftCode) {
            return res.status(200).json({ code: pi.metadata.giftCode, amount: giftEur, type: giftType, duplicate: true });
          }
          // Konsistenz: bezahlter Betrag muss Gutschein + ggf. Versand entsprechen
          const expected = Math.round((giftEur + (giftType === 'hardcopy' ? SHIPPING_EUR : 0)) * 100);
          if (pi.amount !== expected) {
            console.error('[giftcard] Betragsabweichung:', pi.amount, '≠', expected, paymentIntentId);
            return res.status(400).json({ error: 'Zahlungsbetrag stimmt nicht überein.' });
          }
          payRef = paymentIntentId;
        } else {
          // PayPal: autorisierten Betrag von PayPal lesen (Wahrheitsquelle)
          const auth = await getPaypalAuthorization(paypalAuthId);
          authStatus = auth.status;
          if (!['CREATED', 'CAPTURED'].includes(auth.status)) {
            return res.status(402).json({ error: 'PayPal-Zahlung ist nicht autorisiert.' });
          }
          const paidEur = parseFloat(auth.amount?.value);
          if (auth.amount?.currency_code !== 'EUR' || !Number.isFinite(paidEur)) {
            return res.status(400).json({ error: 'Ungültige PayPal-Zahlung.' });
          }
          giftType = type === 'hardcopy' ? 'hardcopy' : 'digital';
          giftEur  = Math.round((paidEur - (giftType === 'hardcopy' ? SHIPPING_EUR : 0)) * 100) / 100;
          if (giftEur < MIN_EUR || giftEur > MAX_EUR) {
            return res.status(400).json({ error: `Betrag muss zwischen ${MIN_EUR} € und ${MAX_EUR} € liegen.` });
          }
          payRef = paypalAuthId;
        }

        if (giftType === 'hardcopy' && (!shipping?.street || !shipping?.zip || !shipping?.city)) {
          return res.status(400).json({ error: 'Versandadresse erforderlich.' });
        }

        // ── Idempotenz: pro Zahlung genau EIN Gutschein, DAUERHAFT ──
        // "pending" läuft nach 24 h ab (abgebrochener Lauf), "done"/"failed" nie: Eine bezahlte Zahlung
        // darf auch nach Tagen keinen zweiten Gutschein erzeugen.
        let redis = null;
        const idemKey = `gc:${payRef}`;
        try {
          const { Redis } = require('@upstash/redis');
          redis = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
          const acquired = await redis.set(idemKey, JSON.stringify({ status: 'pending' }), { nx: true, ex: 86400 });
          if (!acquired) {
            const rawExisting = await redis.get(idemKey);
            const existing = typeof rawExisting === 'string' ? JSON.parse(rawExisting) : rawExisting;
            if (existing?.status === 'done' && existing.code) {
              // Doppelklick/Retry: denselben Gutschein zurückgeben, keinen zweiten anlegen.
              // War der Versand noch nicht vollständig (Abbruch/Fehler beim ersten Lauf), jetzt nachholen.
              if (!isDelivered(existing)) await deliverGiftcard({ redis, idemKey, rec: existing, payRef });
              return res.status(200).json({ code: existing.code, amount: existing.amount, type: existing.type, duplicate: true });
            }
            if (existing?.status === 'failed') {
              return res.status(409).json({ error: 'Zu dieser Zahlung kümmern wir uns schon persönlich und melden uns per E-Mail.' });
            }
            return res.status(409).json({ error: 'Dein Gutschein wird gerade erstellt. Bitte einen Moment warten.' });
          }
        } catch (e) {
          console.error('[giftcard] Redis-Lock fehlgeschlagen, fahre ohne fort:', e.message);
          redis = null;
        }

        // PayPal schon eingezogen, aber kein Gutschein dazu vermerkt (Redis-Eintrag weg oder Lauf abgebrochen):
        // nicht automatisch einen neuen Gutschein ausgeben, sondern euch prüfen lassen.
        if (paypalAuthId && authStatus === 'CAPTURED') {
          if (redis) await redis.set(idemKey, JSON.stringify({ status: 'failed', payRef })).catch(() => {});
          await sendAdminAlert(buyer, giftEur, giftType, payRef, 'PayPal bereits eingezogen, kein Gutschein vermerkt – bitte prüfen, ob schon ein Code existiert').catch(() => {});
          return res.status(409).json({ error: 'Zu dieser Zahlung kümmern wir uns schon persönlich und melden uns per E-Mail.' });
        }

        // ── PayPal erst jetzt einziehen (nach allen Prüfungen) ──
        if (paypalAuthId) {
          await capturePaypalAuth(paypalAuthId).catch(e => {
            // CAPTURED (z.B. durch Retry) ist ok — sonst abbrechen, Lock lösen
            if (!String(e.message).includes('AUTHORIZATION_ALREADY_CAPTURED')) {
              if (redis) redis.del(idemKey).catch(() => {});
              throw e;
            }
          });
        }

        // ── Bookla-Promo-Code anlegen (single_use = einmal einlösbar) ──
        const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || buyer.email;
        const code = generateCode();
        const validUntilDate = new Date();
        validUntilDate.setFullYear(validUntilDate.getFullYear() + VALID_YEARS);

        try {
          await booklaFetch(`/companies/${companyId}/plugins/promocodes/list`, 'POST', {
            code,
            title:          `Gutschein ${fmtEur(giftEur)} — ${buyerName}`,
            description:    `Gekaufter Geschenkgutschein (${giftType}) · Käufer: ${buyer.email} · Zahlung: ${payRef}`,
            discountType:   'amount',
            discountAmount: Math.round(giftEur * 100),
            usageType:      'single_use',
            active:         true,
            activeTo:       validUntilDate.toISOString(),
            metaData:       { source: 'giftcard-shop', payRef, buyerEmail: buyer.email, giftType },
          }, apiKey);
        } catch (e) {
          // Zahlung ist durch, Code-Anlage scheiterte → Admin alarmieren, NICHT refunden.
          console.error('[giftcard] Code-Anlage fehlgeschlagen NACH Zahlung:', e.message, e.details);
          if (redis) await redis.set(idemKey, JSON.stringify({ status: 'failed', payRef })).catch(() => {});   // dauerhaft: ihr klärt das von Hand
          await sendAdminAlert(buyer, giftEur, giftType, payRef, e.message).catch(() => {});
          return res.status(500).json({
            error: 'Dein Gutschein konnte nicht automatisch erstellt werden. Deine Zahlung ist eingegangen — wir melden uns umgehend per E-Mail bei dir!',
          });
        }

        // ── Gutschein steht: sofort dauerhaft an die Zahlung binden (vor PDF/Mails, die scheitern können).
        //    Versand wird getrennt verfolgt (buyerSent/hardcopySent) und bei einer Wiederholung nachgeholt. ──
        const rec = {
          status: 'done', code, amount: giftEur, type: giftType, validUntil: validUntilDate.toISOString(),
          buyerSent: false, hardcopySent: giftType !== 'hardcopy',
          // Nur bis zum vollständigen Versand gespeichert, danach entfernt
          buyer: { firstName: buyer.firstName || '', lastName: buyer.lastName || '', email: buyer.email },
          ...(giftType === 'hardcopy' && { shipping: { street: shipping.street, zip: shipping.zip, city: shipping.city } }),
        };
        if (redis) {
          await redis.set(idemKey, JSON.stringify(rec)).catch(e =>
            console.error('[giftcard] Idempotenz-Eintrag fehlgeschlagen:', e.message));
        }
        if (paymentIntentId) {
          const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
          await stripe.paymentIntents.update(paymentIntentId, { metadata: { giftCode: code } }).catch(e =>
            console.error('[giftcard] Code an Stripe-Zahlung vermerken fehlgeschlagen:', e.message));
        }

        // ── PDF + Mails (Fehler hier brechen den Kauf nicht ab, werden aber nachgeholt) ──
        await deliverGiftcard({ redis, idemKey, rec, payRef, archive: true });

        console.log('[giftcard] Erstellt:', code, fmtEur(giftEur), giftType, 'Käufer:', buyer.email);
        return res.status(201).json({ code, amount: giftEur, type: giftType });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[Giftcard Error]', err);
    return res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
};

// ── Versand (PDF + Mails), wiederaufnehmbar ────────────────────────────────

const isDelivered = rec => rec.buyerSent !== false && rec.hardcopySent !== false;

/**
 * Erzeugt das PDF und verschickt, was laut rec noch fehlt: Käufer-Mail und ggf. Hardcopy-Auftrag an euch.
 * Merkt sich jeden erfolgreichen Teil in Redis, damit eine Wiederholung nur das Fehlende nachholt
 * (kein doppelter Hardcopy-Auftrag). Wirft nie.
 */
async function deliverGiftcard({ redis, idemKey, rec, payRef, archive = false }) {
  try {
    const buyer = rec.buyer || {};
    const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ').trim() || buyer.email;
    const validUntilStr = new Date(rec.validUntil || Date.now())
      .toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const pdfBuffer = await generateGiftcardPDF({ code: rec.code, amountEur: rec.amount, validUntil: validUntilStr, buyerName });

    const [drive, buyerMail, hardcopyMail] = await Promise.allSettled([
      archive ? uploadInvoiceToDrive(pdfBuffer, `${rec.code}.pdf`) : Promise.resolve(),
      rec.buyerSent === false ? sendBuyerEmail(buyer, rec.amount, rec.type, rec.code, pdfBuffer, validUntilStr) : Promise.resolve(),
      rec.hardcopySent === false ? sendAdminHardcopyEmail(buyer, rec.shipping || {}, rec.amount, rec.code, pdfBuffer) : Promise.resolve(),
    ]);
    if (drive.status === 'rejected') console.error('[giftcard] Archiv fehlgeschlagen:', drive.reason?.message);
    if (buyerMail.status === 'fulfilled') rec.buyerSent = true;
    else console.error('[giftcard] Käufer-Mail fehlgeschlagen:', buyerMail.reason?.message);
    if (hardcopyMail.status === 'fulfilled') rec.hardcopySent = true;
    else console.error('[giftcard] Hardcopy-Auftrag fehlgeschlagen:', hardcopyMail.reason?.message);

    if (isDelivered(rec)) { delete rec.buyer; delete rec.shipping; }   // persönliche Daten nicht dauerhaft halten
    if (redis) await redis.set(idemKey, JSON.stringify(rec)).catch(e => console.error('[giftcard] Versandstand nicht gespeichert:', e.message));

    if (!isDelivered(rec)) {
      const missing = [rec.buyerSent ? null : 'Käufer-E-Mail', rec.hardcopySent ? null : 'Hardcopy-Versandauftrag'].filter(Boolean).join(' + ');
      await sendAdminAlert(buyer, rec.amount, rec.type, payRef, `${missing} fehlgeschlagen — Code: ${rec.code}`).catch(() => {});
    }
  } catch (e) {
    console.error('[giftcard] Versand fehlgeschlagen:', e && e.message);
  }
}

// ── Mails ──────────────────────────────────────────────────────────────────

// Resend wirft bei API-Fehlern nicht, sondern liefert { error } → ausdrücklich in einen Fehler umwandeln
async function resendSend(resend, msg) {
  const out = await resend.emails.send(msg);
  if (out && out.error) throw new Error(`Resend: ${out.error.message || out.error.name || 'Versand abgelehnt'}`);
  return out;
}

async function sendBuyerEmail(buyer, eur, type, code, pdfBuffer, validUntilStr) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const isHardcopy = type === 'hardcopy';

  await resendSend(resend, {
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to: buyer.email,
    subject: `🎁 Dein TurmX Games Gutschein über ${fmtEur(eur)}`,
    html: `
      <p>Hallo${buyer.firstName ? ' ' + escapeHtml(buyer.firstName) : ''},</p>
      <p>vielen Dank für deinen Gutschein-Kauf bei TurmX Games!</p>
      ${isHardcopy
        ? `<p>Dein Gutschein über <strong>${fmtEur(eur)}</strong> wird jetzt für dich gedruckt und <strong>per Post versendet</strong>. Als Vorschau findest du ihn bereits im Anhang.</p>`
        : `<p>Im Anhang findest du deinen Gutschein über <strong>${fmtEur(eur)}</strong> als PDF — zum Weiterleiten oder Ausdrucken.</p>`}
      <p>Gutschein-Code: <strong style="font-family:monospace;font-size:16px">${escapeHtml(code)}</strong><br>
      Einlösbar auf <a href="https://booking.turmxgames.de">booking.turmxgames.de</a> im Feld „Rabatt-Code" · gültig bis ${validUntilStr} · einmalig einlösbar.</p>
      <p>Bei Fragen erreichst du uns jederzeit unter <a href="mailto:games@turmx.de">games@turmx.de</a> oder 0 172 585 00 55.</p>
      <p>Viel Freude beim Verschenken!<br>Euer TurmX Games Team</p>
    `,
    attachments: [{ filename: `TurmX-Gutschein-${code}.pdf`, content: pdfBuffer }],
  });
}

async function sendAdminHardcopyEmail(buyer, shipping, eur, code, pdfBuffer) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const buyerName = [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || '—';

  await resendSend(resend, {
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to: (process.env.INQUIRY_EMAIL || 'games@turmx.de').split(',').map(e => e.trim()),
    replyTo: buyer.email,
    subject: `📮 Hardcopy-Gutschein versenden: ${fmtEur(eur)} · ${buyerName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
        <div style="background:#C0392B;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px;letter-spacing:1px">HARDCOPY-GUTSCHEIN VERSENDEN</h2>
          <p style="color:rgba(255,255,255,.8);margin:4px 0 0;font-size:13px">Bezahlt · Druckvorlage im Anhang</p>
        </div>
        <div style="background:#f9f8f6;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e8e5e0;border-top:none">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:7px 0;color:#888;width:140px">Betrag</td><td style="padding:7px 0;font-size:18px;font-weight:700;color:#C0392B">${fmtEur(eur)}</td></tr>
            <tr><td style="padding:7px 0;color:#888">Code</td><td style="padding:7px 0;font-family:monospace;font-weight:700">${escapeHtml(code)}</td></tr>
            <tr><td style="padding:7px 0;color:#888">Käufer</td><td style="padding:7px 0">${escapeHtml(buyerName)} · <a href="mailto:${escapeHtml(buyer.email)}">${escapeHtml(buyer.email)}</a></td></tr>
            <tr><td style="padding:7px 0;color:#888;vertical-align:top">Versandadresse</td><td style="padding:7px 0;font-weight:600">${escapeHtml(shipping.street)}<br>${escapeHtml(shipping.zip)} ${escapeHtml(shipping.city)}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:13px;color:#666">Versandkosten (2,95 €) wurden bezahlt. PDF anbei ausdrucken und versenden.</p>
        </div>
      </div>
    `,
    attachments: [{ filename: `TurmX-Gutschein-${code}.pdf`, content: pdfBuffer }],
  });
}

async function sendAdminAlert(buyer, eur, type, payRef, reason) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resendSend(resend, {
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to: (process.env.INQUIRY_EMAIL || 'games@turmx.de').split(',').map(e => e.trim()),
    subject: `⚠️ GUTSCHEIN-PROBLEM: Zahlung erhalten, manuelle Aktion nötig`,
    html: `
      <p><strong>Ein Gutschein-Kauf braucht manuelle Nacharbeit!</strong></p>
      <p>Käufer: ${escapeHtml([buyer.firstName, buyer.lastName].filter(Boolean).join(' '))} &lt;${escapeHtml(buyer.email)}&gt;<br>
      Betrag: ${fmtEur(eur)} (${escapeHtml(type)})<br>
      Zahlungsreferenz: ${escapeHtml(payRef)}<br>
      Problem: ${escapeHtml(reason)}</p>
      <p>Bitte Code manuell im Bookla-Dashboard anlegen (Promo-Code, Festbetrag, Single Use) und dem Käufer schicken.</p>
    `,
  });
}
