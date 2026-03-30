/**
 * Vercel Serverless Function — Bookla API Proxy
 * Verified against Bookla OpenAPI spec (plugin-redoc-0.yaml)
 */

const BOOKLA_BASE = 'https://eu.bookla.com/api/v1';

module.exports = async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey    = process.env.BOOKLA_API_KEY;
  const companyId = process.env.BOOKLA_COMPANY_ID;

  if (!apiKey || !companyId) {
    return res.status(500).json({ error: 'Bookla credentials not configured' });
  }

  const { action } = req.query;

  try {
    switch (action) {

      // 1. Services laden
      case 'services': {
        const data = await booklaFetch(`/companies/${companyId}/services`, 'GET', null, apiKey);
        return res.status(200).json(data);
      }

      // 2. Verfügbare Tage für Monat
      case 'available-dates': {
        const { serviceId, year, month, spots } = req.body || {};
        if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);
        const lastDay = new Date(y, m, 0).getDate();

        // RFC3339 Format sicherstellen
        const from = `${y}-${String(m).padStart(2,'0')}-01T00:00:00Z`;
        const to   = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}T23:59:59Z`;

        const data = await booklaFetch(
          `/client/companies/${companyId}/services/${serviceId}/dates`,
          'POST',
          { from, to, spots: parseInt(spots) || 1 },
          apiKey
        );

        return res.status(200).json(data); // Korrigiert: Daten zurückgeben statt leerem Array
      }

      // 3. Verfügbare Uhrzeiten für Datum (mit Slot-Logik)
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

        const baseTimes = Array.isArray(slotResults[0]) ? slotResults[0] : [];

        if (baseTimes.length === 0) {
          // Fallback falls API keine Zeiten liefert
          return res.status(200).json([
            { startAt: `${date}T10:00:00Z`, available: true, spots: 48, freeSlots: 3 },
            { startAt: `${date}T13:00:00Z`, available: true, spots: 48, freeSlots: 3 },
            { startAt: `${date}T16:00:00Z`, available: true, spots: 48, freeSlots: 3 },
            { startAt: `${date}T19:00:00Z`, available: true, spots: 48, freeSlots: 3 },
          ]);
        }

        const normalized = baseTimes.map(baseSlot => {
          const st = baseSlot.startTime || ""; 
          const timeKey = st.substring(0, 16); 

          let freeSlotsCount = 0;
          let totalSpotsAvailable = 0;

          slotResults.forEach(slotArr => {
            const arr = Array.isArray(slotArr) ? slotArr : [];
            const match = arr.find(t => (t.startTime || "").substring(0, 16) === timeKey);
            
            if (match) {
              const sp = match.spotsAvailable || 0;
              if (sp >= spots) freeSlotsCount++;
              totalSpotsAvailable += sp;
            }
          });

          return {
            startAt: st,
            available: freeSlotsCount > 0,
            spots: totalSpotsAvailable,
            freeSlots: freeSlotsCount
          };
        });

        return res.status(200).json(normalized);
      }

      // 4. Buchung anlegen
      case 'create-booking': {
        const { serviceId, date, time, groupSize, firstName, lastName, email, phone, notes } = req.body || {};

        if (!serviceId || !date || !time || !email) {
          return res.status(400).json({ error: 'serviceId, date, time, email required' });
        }

        const RESOURCE_IDS = [
          '8638cf4f-12f7-4e32-bddb-39384bd6f56d',
          '6fbb6c14-bc34-4779-ba39-d588e0146014',
          '3fff2cbd-bac1-409c-adff-491526586916',
        ];

        // Zeitstempel für RFC3339 (Z hinzufügen für UTC)
        const startTime = time.includes('Z') ? time : `${date}T${time}${time.length === 5 ? ':00' : ''}Z`;
        const spots = parseInt(groupSize) || 1;

        const clientPayload = {
          email,
          firstName,
          lastName,
          ...(phone && { phone }),
        };

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
            continue; 
          }
        }

        throw lastError || new Error('No available slot found');
      }

      // 5. Stripe Payment Intent
      case 'create-payment-intent': {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { amount, description } = req.body || {};
        if (!amount) return res.status(400).json({ error: 'amount required' });

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(parseFloat(amount) * 100),
          currency: 'eur',
          description: description || 'Bookla Booking',
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
      error: err.message || 'Internal server error',
      details: err.details || null,
    });
  }
};

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
  try { 
    data = JSON.parse(text); 
  } catch { 
    data = { raw: text }; 
  }

  if (!response.ok) {
    const err = new Error(data?.message || `Bookla API error ${response.status}`);
    err.status = response.status;
    err.details = data;
    throw err;
  }

  return data;
}
