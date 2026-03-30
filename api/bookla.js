/**
 * Vercel Serverless Function — Bookla API Proxy
 * Datei: /api/bookla.js
 *
 * Alle Bookla-Requests laufen durch diese Funktion,
 * damit der API Key niemals im Frontend sichtbar ist.
 *
 * Setup: BOOKLA_API_KEY und BOOKLA_COMPANY_ID in Vercel Environment Variables setzen
 */

const BOOKLA_BASE = 'https://eu.bookla.com/api/v1';

module.exports = async function handler(req, res) {
  // CORS — nur deine Domain erlauben (in Produktion anpassen)
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey     = process.env.BOOKLA_API_KEY;
  const companyId  = process.env.BOOKLA_COMPANY_ID;

  if (!apiKey || !companyId) {
    return res.status(500).json({ error: 'Bookla credentials not configured' });
  }

  const { action } = req.query;

  try {
    switch (action) {

      // ─────────────────────────────────────────────
      // 1. Services laden (Event-Typen)
      //    GET /api/bookla?action=services
      // ─────────────────────────────────────────────
      case 'services': {
        const data = await booklaFetch(`/companies/${companyId}/services`, 'GET', null, apiKey);
        return res.status(200).json(data);
      }

      // ─────────────────────────────────────────────
      // 2. Freie Tage für einen Service laden
      //    POST /api/bookla?action=available-dates
      //    Body: { serviceId, resourceId, year, month }
      // ─────────────────────────────────────────────
      case 'available-dates': {
        const { serviceId, resourceId, year, month } = req.body;
        if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

        const payload = {
          year:  parseInt(year),
          month: parseInt(month), // 1–12
          ...(resourceId && { resourceId }),
        };

        const data = await booklaFetch(
          `/client/companies/${companyId}/services/${serviceId}/available-dates`,
          'POST', payload, apiKey
        );
        return res.status(200).json(data);
      }

      // ─────────────────────────────────────────────
      // 3. Freie Uhrzeiten für Datum laden
      //    POST /api/bookla?action=available-times
      //    Body: { serviceId, resourceId, date, groupSize }
      // ─────────────────────────────────────────────
      case 'available-times': {
        const { serviceId, resourceId, date, groupSize } = req.body;
        if (!serviceId || !date) return res.status(400).json({ error: 'serviceId + date required' });

        const payload = {
          date,                                        // "YYYY-MM-DD"
          ...(resourceId && { resourceId }),
          ...(groupSize  && { spots: parseInt(groupSize) }),
        };

        const data = await booklaFetch(
          `/client/companies/${companyId}/services/${serviceId}/available-times`,
          'POST', payload, apiKey
        );
        return res.status(200).json(data);
      }

      // ─────────────────────────────────────────────
      // 4. Buchung anlegen (nach erfolgreicher Zahlung!)
      //    POST /api/bookla?action=create-booking
      //    Body: { serviceId, resourceId, date, time, groupSize,
      //            firstName, lastName, email, phone,
      //            paymentIntentId, notes }
      // ─────────────────────────────────────────────
      case 'create-booking': {
        const {
          serviceId, resourceId, date, time, groupSize,
          firstName, lastName, email, phone,
          paymentIntentId, notes
        } = req.body;

        if (!serviceId || !date || !time || !email) {
          return res.status(400).json({ error: 'serviceId, date, time, email required' });
        }

        // Bookla erwartet ISO datetime: "2025-06-15T14:00:00Z"
        const startAt = `${date}T${time}:00Z`;

        const payload = {
          companyID:  companyId,
          serviceID:  serviceId,
          startTime:  startAt,
          spots:      parseInt(groupSize) || 1,
          ...(resourceId && { resourceID: resourceId }),
          client: {
            firstName,
            lastName,
            email,
            ...(phone && { phone }),
          },
          ...(notes && { metaData: { notes } }),
        };

        const data = await booklaFetch(
          `/client/companies/${companyId}/bookings`,
          'POST', payload, apiKey
        );
        return res.status(201).json(data);
      }

      // ─────────────────────────────────────────────
      // 5. Stripe Payment Intent erstellen
      //    POST /api/bookla?action=create-payment-intent
      //    Body: { amount, currency, description, metadata }
      // ─────────────────────────────────────────────
      case 'create-payment-intent': {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { amount, description, metadata } = req.body;

        if (!amount) return res.status(400).json({ error: 'amount required' });

        const paymentIntent = await stripe.paymentIntents.create({
          amount:   Math.round(parseFloat(amount) * 100), // Cent
          currency: 'eur',
          description,
          metadata: metadata || {},
          automatic_payment_methods: { enabled: true },
        });

        return res.status(200).json({ clientSecret: paymentIntent.client_secret });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

  } catch (err) {
    console.error('[Bookla Proxy Error]', err);
    return res.status(err.status || 500).json({
      error:   err.message || 'Internal server error',
      details: err.details || null,
    });
  }
}

// ─── Hilfsfunktion: Fetch gegen Bookla REST API ───────────────────────────────
async function booklaFetch(path, method, body, apiKey) {
  const url = `${BOOKLA_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    ...(body && { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    const err = new Error(data?.message || `Bookla API error ${response.status}`);
    err.status  = response.status;
    err.details = data;
    throw err;
  }

  return data;
}
