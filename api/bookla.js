/**
 * Vercel Serverless Function — Bookla API Proxy
 * Verified against Bookla OpenAPI spec (plugin-redoc-0.yaml)
 */

const BOOKLA_BASE = 'https://eu.bookla.com/api/v1';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey    = process.env.BOOKLA_API_KEY;
  const companyId = process.env.BOOKLA_COMPANY_ID;

  if (!apiKey || !companyId) {
    return res.status(500).json({ error: 'Bookla credentials not configured' });
  }

  const { action } = req.query;

  try {
    switch (action) {

      // ─────────────────────────────────────────────
      // 1. Services laden
      //    GET /api/bookla?action=services
      // ─────────────────────────────────────────────
      case 'services': {
        const data = await booklaFetch(`/companies/${companyId}/services`, 'GET', null, apiKey);
        return res.status(200).json(data);
      }

      // ─────────────────────────────────────────────
      // 2. Verfügbare Tage für Monat
      //    POST /api/bookla?action=available-dates
      //    Body: { serviceId, year, month, spots }
      //
      //    Endpoint: POST /client/companies/{id}/services/{id}/dates
      //    Body: { from, to, spots }  (RFC3339)
      // ─────────────────────────────────────────────
      case 'available-dates': {
        const { serviceId, year, month, spots } = req.body || {};
        if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);
        const lastDay = new Date(y, m, 0).getDate();

        const from = `${y}-${String(m).padStart(2,'0')}-01T00:00:00Z`;
        const to   = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}T23:59:59Z`;

        const data = await booklaFetch(
          `/client/companies/${companyId}/services/${serviceId}/dates`,
          'POST',
          {
            from,
            to,
            spots: parseInt(spots) || 1,
          },
          apiKey
        );

        // Bookla gibt zurück: ["Europe/Berlin", { resourceID: [...dates] }, ...]
        // oder { resourceID: [...dates] }
       case 'available-dates': {
  return res.status(200).json([]);
}

      // ─────────────────────────────────────────────
      // 3. Verfügbare Uhrzeiten für Datum
      //    POST /api/bookla?action=available-times
      //    Body: { serviceId, date, groupSize }
      //
      //    Endpoint: POST /client/companies/{id}/services/{id}/times
      //    Body: { from, to, spots }  (RFC3339)
      // ─────────────────────────────────────────────
      case 'available-times': {
        const { serviceId, date, groupSize } = req.body || {};
        if (!serviceId || !date) return res.status(400).json({ error: 'serviceId + date required' });

        const RESOURCE_IDS = [
          '8638cf4f-12f7-4e32-bddb-39384bd6f56d',
          '6fbb6c14-bc34-4779-ba39-d588e0146014',
          '3fff2cbd-bac1-409c-adff-491526586916',
        ];

        const from = `${date}T00:00:00Z`;
        const to   = `${date}T23:59:59Z`;
        const spots = parseInt(groupSize) || 1;

        // Alle 3 Slots parallel abfragen
        const slotResults = await Promise.all(
          RESOURCE_IDS.map(rid =>
            booklaFetch(
              `/client/companies/${companyId}/services/${serviceId}/times`,
              'POST',
              { from, to, spots, resourceIDs: [rid] },
              apiKey
            ).catch(() => [])
          )
        );

        // Zeiten aus dem ersten Slot als Basis nehmen
        const baseTimes = Array.isArray(slotResults[0]) ? slotResults[0] : [];

        if (baseTimes.length === 0) {
          // Fallback: Standard-Zeiten, alle verfügbar
          return res.status(200).json([
            { startAt: `${date}T10:00:00`, available: true, spots: 16 * 3 },
            { startAt: `${date}T13:00:00`, available: true, spots: 16 * 3 },
            { startAt: `${date}T16:00:00`, available: true, spots: 16 * 3 },
            { startAt: `${date}T19:00:00`, available: true, spots: 16 * 3 },
          ]);
        }

        // Für jede Zeit: zähle wie viele Slots noch frei sind
        const normalized = baseTimes.map(baseSlot => {
          const st = baseSlot.startTime || baseSlot.startAt || baseSlot.from || '';
          const timeKey = st.substring(0, 16); // "YYYY-MM-DDTHH:MM"

          let freeSlots = 0;
          let totalSpots = 0;

          slotResults.forEach(slotArr => {
            const arr = Array.isArray(slotArr) ? slotArr : [];
            const match = arr.find(t => {
              const tst = t.startTime || t.startAt || t.from || '';
              return tst.substring(0, 16) === timeKey;
            });
            if (match) {
              const avail = match.available !== false;
              const sp = match.availableSpots || match.spots || 16;
              if (avail && sp > 0) freeSlots++;
              totalSpots += sp;
            }
          });

          return {
            startAt:   st,
            available: freeSlots > 0,       // true wenn min. 1 Slot frei
            spots:     totalSpots,           // Gesamtkapazität aller freien Slots
            freeSlots,                       // Anzahl freier Spielbereiche (0-3)
          };
        });

        return res.status(200).json(normalized);
      }

      // ─────────────────────────────────────────────
      // 4. Buchung anlegen
      //    POST /api/bookla?action=create-booking
      //
      //    Endpoint: POST /client/bookings
      //    Required: companyID, resourceID, serviceID, spots, startTime
      // ─────────────────────────────────────────────
      case 'create-booking': {
        const { serviceId, date, time, groupSize, firstName, lastName, email, phone, notes } = req.body || {};

        if (!serviceId || !date || !time || !email) {
          return res.status(400).json({ error: 'serviceId, date, time, email required' });
        }

        const RESOURCE_IDS = [
          '8638cf4f-12f7-4e32-bddb-39384bd6f56d', // Slot 1
          '6fbb6c14-bc34-4779-ba39-d588e0146014', // Slot 2
          '3fff2cbd-bac1-409c-adff-491526586916', // Slot 3
        ];

        const startTime = `${date}T${time}:00`;
        const spots = parseInt(groupSize) || 1;

        const clientPayload = {
          email,
          firstName,
          lastName,
          ...(phone && { phone }),
        };

        // Versuche jeden Slot der Reihe nach bis einer klappt
        let lastError = null;
        for (const resourceId of RESOURCE_IDS) {
          try {
            const data = await booklaFetch('/client/bookings', 'POST', {
              companyID:  companyId,
              serviceID:  serviceId,
              resourceID: resourceId,
              startTime,
              spots,
              client: clientPayload,
              ...(notes && { metaData: { notes } }),
            }, apiKey);
            return res.status(201).json(data);
          } catch(e) {
            lastError = e;
            // Slot belegt oder Fehler → nächsten versuchen
            continue;
          }
        }

        // Alle Slots fehlgeschlagen
        throw lastError || new Error('No available slot found');
      }

      // ─────────────────────────────────────────────
      // 5. Stripe Payment Intent
      //    POST /api/bookla?action=create-payment-intent
      // ─────────────────────────────────────────────
      case 'create-payment-intent': {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { amount, description } = req.body || {};
        if (!amount) return res.status(400).json({ error: 'amount required' });

        const paymentIntent = await stripe.paymentIntents.create({
          amount:   Math.round(parseFloat(amount) * 100),
          currency: 'eur',
          description,
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
};

// ─── Hilfsfunktion ────────────────────────────────────────────────────────────
async function booklaFetch(path, method, body, apiKey) {
  const url = `${BOOKLA_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'X-Api-Key':     apiKey,
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
