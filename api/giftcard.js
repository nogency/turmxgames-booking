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
  const res  = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
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
  const res = await fetch(`https://api-m.paypal.com/v2/payments/authorizations/${authorizationId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth lookup failed: ${data.message || res.status}`);
  return data;
}

async function capturePaypalAuth(authorizationId) {
  const token = await getPaypalAccessToken();
  const res = await fetch(`https://api-m.paypal.com/v2/payments/authorizations/${authorizationId}/capture`, {
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

        // ── Idempotenz: pro Zahlung genau EIN Gutschein ──
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
              // Doppelklick/Retry: denselben Gutschein zurückgeben, keinen zweiten anlegen
              return res.status(200).json({ code: existing.code, amount: existing.amount, type: existing.type, duplicate: true });
            }
            return res.status(409).json({ error: 'Dein Gutschein wird gerade erstellt. Bitte einen Moment warten.' });
          }
        } catch (e) {
          console.error('[giftcard] Redis-Lock fehlgeschlagen, fahre ohne fort:', e.message);
          redis = null;
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
          if (redis) await redis.set(idemKey, JSON.stringify({ status: 'failed', payRef }), { ex: 86400 }).catch(() => {});
          await sendAdminAlert(buyer, giftEur, giftType, payRef, e.message).catch(() => {});
          return res.status(500).json({
            error: 'Dein Gutschein konnte nicht automatisch erstellt werden. Deine Zahlung ist eingegangen — wir melden uns umgehend per E-Mail bei dir!',
          });
        }

        // ── PDF erzeugen ──
        const validUntilStr = validUntilDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const pdfBuffer = await generateGiftcardPDF({
          code,
          amountEur:  giftEur,
          validUntil: validUntilStr,
          buyerName,
        });

        // ── Archiv + Mails (Fehler hier brechen den Kauf nicht ab) ──
        const results = await Promise.allSettled([
          uploadInvoiceToDrive(pdfBuffer, `${code}.pdf`),
          sendBuyerEmail(buyer, giftEur, giftType, code, pdfBuffer, validUntilStr),
          giftType === 'hardcopy'
            ? sendAdminHardcopyEmail(buyer, shipping, giftEur, code, pdfBuffer)
            : Promise.resolve(),
        ]);
        results.forEach((r, i) => {
          if (r.status === 'rejected') console.error('[giftcard] Nachgelagerter Schritt', i, 'fehlgeschlagen:', r.reason?.message);
        });
        if (results[1].status === 'rejected') {
          // Käufer-Mail ist kritisch → Admin informieren
          await sendAdminAlert(buyer, giftEur, giftType, payRef, 'Käufer-E-Mail fehlgeschlagen — Code: ' + code).catch(() => {});
        }

        if (redis) {
          await redis.set(idemKey, JSON.stringify({ status: 'done', code, amount: giftEur, type: giftType }), { ex: 86400 }).catch(() => {});
        }

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

// ── Mails ──────────────────────────────────────────────────────────────────

async function sendBuyerEmail(buyer, eur, type, code, pdfBuffer, validUntilStr) {
  const { Resend } = require('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const isHardcopy = type === 'hardcopy';

  await resend.emails.send({
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

  await resend.emails.send({
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
  await resend.emails.send({
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
