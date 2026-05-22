/**
 * Vercel Serverless Function — Bookla API Proxy
 * Verified against Bookla OpenAPI spec (plugin-redoc-0.yaml)
 */

const { DateTime } = require('luxon');

const BOOKLA_BASE = 'https://eu.bookla.com/api/v1';

const RESOURCE_IDS = [
  '8638cf4f-12f7-4e32-bddb-39384bd6f56d', // TurmXGames Slot 1
  '6fbb6c14-bc34-4779-ba39-d588e0146014', // TurmXGames Slot 2
  '3fff2cbd-bac1-409c-adff-491526586916', // TurmXGames Slot 3
];

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
      // ─────────────────────────────────────────────
      case 'services': {
        const data = await booklaFetch(`/companies/${companyId}/services`, 'GET', null, apiKey);
        return res.status(200).json(data);
      }

      // ─────────────────────────────────────────────
      // 2. Verfügbare Tage für Monat
      // ─────────────────────────────────────────────
      case 'available-dates': {
        const { serviceId, year, month } = req.body || {};
        if (!serviceId) return res.status(400).json({ error: 'serviceId required' });

        const y = parseInt(year) || new Date().getFullYear();
        const m = parseInt(month) || (new Date().getMonth() + 1);
        const lastDay = new Date(y, m, 0).getDate();

        const from = `${y}-${String(m).padStart(2,'0')}-01T00:00:00Z`;
        const to   = `${y}-${String(m).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}T23:59:59Z`;

        try {
          const data = await booklaFetch(
            `/client/companies/${companyId}/services/${serviceId}/dates`,
            'POST',
            { from, to, spots: 1 },
            apiKey
          );

          let dates = [];
          if (Array.isArray(data)) {
            dates = data
              .filter(item => typeof item === 'object' && item !== null)
              .flatMap(obj => Object.values(obj).flat())
              .filter(d => typeof d === 'string' && d.match(/^\d{4}-\d{2}-\d{2}$/));
            dates = [...new Set(dates)].sort();
          }
          return res.status(200).json(dates);
        } catch(e) {
          return res.status(200).json([]);
        }
      }

      // ─────────────────────────────────────────────
      // 3. Verfügbare Uhrzeiten für Datum
      //    EXKLUSIV: Slot ist nur frei wenn KEINE
      //    einzige Buchung drin ist (spotsAvailable === totalSpots)
      // ─────────────────────────────────────────────
      case 'available-times': {
        const { serviceId, date, groupSize } = req.body || {};
        if (!serviceId || !date) return res.status(400).json({ error: 'serviceId + date required' });

        const from  = `${date}T00:00:00Z`;
        const to    = `${date}T23:59:59Z`;
        const spots = parseInt(groupSize) || 1;

        const slotResults = await Promise.all(
          RESOURCE_IDS.map(rid =>
            booklaFetch(
              `/client/companies/${companyId}/services/${serviceId}/times`,
              'POST',
              { from, to, spots, resourceIDs: [rid] },
              apiKey
            )
            .then(data => { console.log('[BOOKLA RAW]', JSON.stringify(data)); return data; })
            .catch(e  => { console.error('[BOOKLA ERR]', e.message, e.details); return null; })
          )
        );

        const slotArrays = slotResults.map((data, i) => {
          if (!data || !data.times) return [];
          const rid = RESOURCE_IDS[i];
          return data.times[rid] || Object.values(data.times).flat() || [];
        });

        const allSlots = slotArrays.flat().filter(Boolean);
        if (allSlots.length === 0) return res.status(200).json([]);

        const uniqueStartTimes = [...new Set(
          allSlots.map(s => s.startTime).filter(Boolean)
        )].sort();

        const normalized = uniqueStartTimes.map(st => {
          const timeKey = st.substring(0, 16);
          let freeSlotsCount  = 0;
          let totalSpotsAvail = 0;

          slotArrays.forEach(slotArr => {
            const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === timeKey);
            if (match) {
              const available = match.spotsAvailable || 0;
              const total     = match.totalSpots || 0;
              if (available === total && total > 0) freeSlotsCount++;
              totalSpotsAvail += available;
            }
          });

          return {
            startAt:   st,
            available: freeSlotsCount > 0,
            spots:     totalSpotsAvail,
            freeSlots: freeSlotsCount,
          };
        });

        return res.status(200).json(normalized);
      }

      // ─────────────────────────────────────────────
      // 4. Buchung anlegen
      //    Erst prüfen ob Slot noch wirklich frei ist,
      //    dann nur auf einem freien Slot buchen.
      // ─────────────────────────────────────────────
      case 'create-booking': {
        const { serviceId, date, time, groupSize, firstName, lastName, email, phone, notes, promoCode, paypalAuthId } = req.body || {};

        if (!serviceId || !date || !time || !email) {
          // PayPal-Autorisierung sofort voiden → Hold beim Kunden fällt sofort weg
          if (paypalAuthId) {
            await voidPaypalAuth(paypalAuthId).catch(e =>
              console.error('[PayPal] Void bei 400 fehlgeschlagen:', e.message)
            );
          }
          return res.status(400).json({ error: 'serviceId, date, time, email required' });
        }

        const spots = parseInt(groupSize) || 1;

        const berlinDt  = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Berlin' });
        const startTime = berlinDt.toISO();
        const utcTimeKey = berlinDt.toUTC().toISO().substring(0, 16);

        // ── Schritt 1: Aktuelle Verfügbarkeit pro Ressource prüfen ──
        const from = `${date}T00:00:00Z`;
        const to   = `${date}T23:59:59Z`;

        const currentAvailability = await Promise.all(
          RESOURCE_IDS.map(rid =>
            booklaFetch(
              `/client/companies/${companyId}/services/${serviceId}/times`,
              'POST',
              { from, to, spots, resourceIDs: [rid] },
              apiKey
            ).catch(() => null)
          )
        );

        const freeResourceIds = [];
        currentAvailability.forEach((data, i) => {
          if (!data || !data.times) return;
          const rid = RESOURCE_IDS[i];
          const slotArr = data.times[rid] || Object.values(data.times).flat() || [];
          const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === utcTimeKey);
          if (match && match.spotsAvailable === match.totalSpots && match.totalSpots > 0) {
            freeResourceIds.push(rid);
          }
        });

        if (freeResourceIds.length === 0) {
          // Slot nicht verfügbar — PayPal-Autorisierung freigeben
          if (paypalAuthId) await voidPaypalAuth(paypalAuthId).catch(e => console.error('[PayPal] Void failed:', e.message));
          return res.status(409).json({ error: 'Dieser Slot ist leider nicht mehr verfügbar.' });
        }

        // ── Schritt 2: Auf erstem freien Slot buchen ──
        const clientPayload = { email, firstName, lastName, ...(phone && { phone }) };

        let lastError = null;
        for (const resourceId of freeResourceIds) {
          try {
            const bookingBody = {
              companyID:  companyId,
              serviceID:  serviceId,
              resourceID: resourceId,
              startTime,
              spots,
              client: clientPayload,
              ...(notes     && { metaData: { notes } }),
              ...(promoCode && { code: promoCode }),
            };
            const data = await booklaFetch('/client/bookings', 'POST', bookingBody, apiKey);

            // Bookla-Buchung erfolgreich — PayPal-Autorisierung einziehen
            if (paypalAuthId) {
              await capturePaypalAuth(paypalAuthId).catch(e =>
                console.error('[PayPal] Capture failed after booking (manual action needed):', e.message)
              );
            }

            return res.status(201).json(data);
          } catch(e) {
            lastError = e;
            continue;
          }
        }

        // Alle Slots fehlgeschlagen — PayPal-Autorisierung freigeben
        if (paypalAuthId) await voidPaypalAuth(paypalAuthId).catch(e => console.error('[PayPal] Void failed:', e.message));
        throw lastError || new Error('Alle Slots belegt');
      }

      // ─────────────────────────────────────────────
      // 4b. Buchung + Rechnung (Auf Rechnung Pfad)
      //     Legt Bookla-Buchung an und verschickt
      //     sofort die Rechnung mit Bankdaten.
      // ─────────────────────────────────────────────
      case 'create-booking-invoice': {
        const {
          serviceId, date, time, groupSize, firstName, lastName,
          email, phone, notes, promoCode, serviceName, amount,
          companyName, companyStreet, companyZip, companyCity, ustId,
          drinksFlat, drinksPrice, insurance, baseAmount,
        } = req.body || {};

        if (!serviceId || !date || !time || !email || !amount) {
          return res.status(400).json({ error: 'serviceId, date, time, email, amount required' });
        }

        const spots = parseInt(groupSize) || 1;
        const berlinDt  = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Berlin' });
        const startTime = berlinDt.toISO();
        const utcTimeKey = berlinDt.toUTC().toISO().substring(0, 16);

        const from = `${date}T00:00:00Z`;
        const to   = `${date}T23:59:59Z`;

        const currentAvailability = await Promise.all(
          RESOURCE_IDS.map(rid =>
            booklaFetch(
              `/client/companies/${companyId}/services/${serviceId}/times`,
              'POST', { from, to, spots, resourceIDs: [rid] }, apiKey
            ).catch(() => null)
          )
        );

        const freeResourceIds = [];
        currentAvailability.forEach((data, i) => {
          if (!data || !data.times) return;
          const rid = RESOURCE_IDS[i];
          const slotArr = data.times[rid] || Object.values(data.times).flat() || [];
          const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === utcTimeKey);
          if (match && match.spotsAvailable === match.totalSpots && match.totalSpots > 0) {
            freeResourceIds.push(rid);
          }
        });

        if (freeResourceIds.length === 0) {
          return res.status(409).json({ error: 'Dieser Slot ist leider nicht mehr verfügbar.' });
        }

        let bookingData = null;
        let lastError = null;
        for (const resourceId of freeResourceIds) {
          try {
            bookingData = await booklaFetch('/client/bookings', 'POST', {
              companyID:  companyId,
              serviceID:  serviceId,
              resourceID: resourceId,
              startTime,
              spots,
              client: { email, firstName, lastName, ...(phone && { phone }) },
              ...(notes     && { metaData: { notes } }),
              ...(promoCode && { code: promoCode }),
            }, apiKey);
            break;
          } catch (e) { lastError = e; }
        }

        if (!bookingData) throw lastError || new Error('Alle Slots belegt');

        // Rechnung generieren und verschicken
        const { buildInvoiceData } = require('./_lib/invoice-data');
        const { generateInvoicePDF } = require('./_lib/pdf');
        const { sendInvoiceEmail } = require('./_lib/email');
        const { uploadInvoiceToDrive } = require('./_lib/drive');

        const invoiceData = buildInvoiceData({
          bookingId: bookingData.id,
          serviceName: serviceName || serviceId,
          groupSize: spots,
          amount,
          baseAmount,
          drinksFlat: drinksFlat || false,
          drinksPrice: drinksPrice || 12.90,
          insurance: insurance || false,
          paymentMethod: 'invoice',
          date, time,
          firstName, lastName, email, phone,
          companyName, companyStreet, companyZip, companyCity, ustId,
        });

        const pdfBuffer = await generateInvoicePDF(invoiceData);

        // Email + Drive parallel — Drive-Fehler brechen Buchung nicht ab
        const [emailResult, driveResult] = await Promise.allSettled([
          sendInvoiceEmail({ to: email, invoiceNumber: invoiceData.invoiceNumber, pdfBuffer }),
          uploadInvoiceToDrive(pdfBuffer, `${invoiceData.invoiceNumber}.pdf`),
        ]);
        if (driveResult.status === 'rejected') {
          console.error('[Drive] Upload fehlgeschlagen:', driveResult.reason?.message);
        }
        if (emailResult.status === 'rejected') {
          throw emailResult.reason;
        }

        return res.status(201).json({ ...bookingData, invoiceId: invoiceData.invoiceNumber });
      }

      // ─────────────────────────────────────────────
      // 4c. Admin-Buchung bestätigen (nach Kundenzahlung)
      //     Setzt Bookla-Status auf "confirmed" und
      //     zieht ggf. PayPal-Autorisierung ein.
      // ─────────────────────────────────────────────
      case 'confirm-admin-booking': {
        const { bookingId, paypalAuthId, notes, adminLinkId } = req.body || {};
        if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

        // PayPal einziehen (falls Autorisierung vorhanden)
        if (paypalAuthId) {
          await capturePaypalAuth(paypalAuthId).catch(e =>
            console.error('[PayPal] Capture fehlgeschlagen:', e.message)
          );
        }

        // ── clientID aus Redis holen ──
        // Bookla leert den Client beim PATCH wenn clientID nicht mitgesendet wird.
        // Daher speichern wir die clientID beim Link-Erstellen in Redis und lesen sie hier wieder aus.
        let storedClientId = null;
        if (adminLinkId) {
          try {
            const { Redis } = require('@upstash/redis');
            const redis = new Redis({
              url:   process.env.KV_REST_API_URL,
              token: process.env.KV_REST_API_TOKEN,
            });
            const raw = await redis.get(`bl:${adminLinkId}`);
            if (raw) {
              const stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
              storedClientId = stored.clientId || null;
            }
            console.log('[Bookla] clientID aus Redis:', storedClientId);
          } catch (e) {
            console.warn('[Redis] clientId-Lookup fehlgeschlagen:', e.message);
          }
        }

        // ── Bookla-Buchung auf "confirmed" setzen ──
        // Best-effort: falls PATCH scheitert, trotzdem Erfolg — Zahlung + Rechnung müssen durch.
        let confirmed = { bookingId };
        try {
          const patchBody = {
            status: 'confirmed',
            metaData: {
              notes:         notes || null,
              paymentStatus: 'paid',
              adminLink:     adminLinkId || null,
            },
            ...(storedClientId && { clientID: storedClientId }),
          };
          confirmed = await booklaFetch(
            `/companies/${companyId}/bookings/${bookingId}`,
            'PATCH',
            patchBody,
            apiKey
          );
          console.log('[Bookla] Status → confirmed OK, clientID:', storedClientId);
        } catch (patchErr) {
          console.error('[Bookla] Status-Update fehlgeschlagen (manuell prüfen):', patchErr.message, patchErr.details);
        }

        return res.status(200).json(confirmed);
      }

      // ─────────────────────────────────────────────
      // 5. Promo Code validieren
      //    Gibt zurück: { canApply, price, discountAmount }
      // ─────────────────────────────────────────────
      case 'validate-code': {
        const { code, serviceId, date, time, groupSize } = req.body || {};
        if (!code || !serviceId || !date || !time) {
          return res.status(400).json({ error: 'code, serviceId, date, time required' });
        }

        const spots = parseInt(groupSize) || 1;
        const berlinDtV  = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Berlin' });
        const startTime  = berlinDtV.toISO();
        const utcTimeKey = berlinDtV.toUTC().toISO().substring(0, 16);
        const resourceId = RESOURCE_IDS[0];

        // Parallel: Code validieren + echten Slot-Preis aus times holen
        const [data, timesData] = await Promise.all([
          booklaFetch(
            `/client/codes/${encodeURIComponent(code)}/validate`,
            'POST',
            { code, companyID: companyId, serviceID: serviceId, resourceID: resourceId, startTime, spots },
            apiKey
          ),
          booklaFetch(
            `/client/companies/${companyId}/services/${serviceId}/times`,
            'POST',
            { from: `${date}T00:00:00Z`, to: `${date}T23:59:59Z`, spots, resourceIDs: [resourceId] },
            apiKey
          ).catch(() => null),
        ]);

        // Slot-Preis (Basispreis ohne Rabatt) aus times-Response extrahieren
        let booklaBaseCents = null;
        if (timesData?.times) {
          const slotArr = timesData.times[resourceId] || Object.values(timesData.times).flat() || [];
          const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === utcTimeKey);
          console.log('[validate-code] slot match:', JSON.stringify(match));
          // Bookla kann price als Cent-Ganzzahl oder als Float-Euro liefern
          if (match?.price != null) {
            booklaBaseCents = match.price > 500 ? match.price : Math.round(match.price * 100);
          } else if (match?.totalPrice != null) {
            booklaBaseCents = match.totalPrice > 500 ? match.totalPrice : Math.round(match.totalPrice * 100);
          }
        }

        // Rabatt = echter Slot-Basispreis minus Bookla-Neupreis (beide in Cent)
        const discountAmount = (booklaBaseCents != null && data.price != null)
          ? Math.max(0, booklaBaseCents - data.price)
          : null;

        console.log('[validate-code]', { booklaBaseCents, discountedPrice: data.price, discountAmount });
        return res.status(200).json({ ...data, discountAmount, booklaBaseCents });
      }

      // ─────────────────────────────────────────────
      // 6. Stripe Payment Intent
      // ─────────────────────────────────────────────
      case 'create-payment-intent': {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const { amount, description, paymentMethodType } = req.body || {};
        if (!amount) return res.status(400).json({ error: 'amount required' });

        const isSepa = paymentMethodType === 'sepa_debit';
        const paymentIntent = await stripe.paymentIntents.create({
          amount:   Math.round(parseFloat(amount) * 100),
          currency: 'eur',
          description: description || 'TurmX Games Booking',
          ...(isSepa
            ? { payment_method_types: ['sepa_debit'] }
            : { automatic_payment_methods: { enabled: true } }
          ),
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

async function booklaFetch(path, method, body, apiKey) {
  const url = `${BOOKLA_BASE}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key':    apiKey,
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

// ─────────────────────────────────────────────
// PayPal Authorize / Capture / Void Helpers
// ─────────────────────────────────────────────
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

async function capturePaypalAuth(authorizationId) {
  const token = await getPaypalAccessToken();
  const res   = await fetch(
    `https://api-m.paypal.com/v2/payments/authorizations/${authorizationId}/capture`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
    }
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(`PayPal capture failed: ${JSON.stringify(data)}`);
  }
  console.log('[PayPal] Authorization captured:', authorizationId);
}

async function voidPaypalAuth(authorizationId) {
  const token = await getPaypalAccessToken();
  const res   = await fetch(
    `https://api-m.paypal.com/v2/payments/authorizations/${authorizationId}/void`,
    {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`PayPal void failed: ${JSON.stringify(data)}`);
  }
  console.log('[PayPal] Authorization voided:', authorizationId);
}
