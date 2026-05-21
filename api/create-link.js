const { Redis }    = require('@upstash/redis');
const { DateTime } = require('luxon');

const BOOKLA_BASE  = 'https://eu.bookla.com/api/v1';
const SERVICE_ID   = '8bd533a6-a6a2-4abb-b170-134b6aab74ce';
const RESOURCE_IDS = [
  '8638cf4f-12f7-4e32-bddb-39384bd6f56d', // TurmXGames Slot 1
  '6fbb6c14-bc34-4779-ba39-d588e0146014', // TurmXGames Slot 2
  '3fff2cbd-bac1-409c-adff-491526586916', // TurmXGames Slot 3
];

function generateId(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function bFetch(path, method, body, apiKey) {
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

/** Sucht existierenden Bookla-Client per E-Mail oder legt ihn neu an. */
async function findOrCreateClient(companyId, { email, firstName, lastName, phone }, apiKey) {
  // 1. Nach vorhandenem Client suchen
  const search = await bFetch(
    `/companies/${companyId}/clients/search?email=${encodeURIComponent(email)}`,
    'GET', null, apiKey
  ).catch(() => []);

  if (Array.isArray(search) && search.length > 0) {
    return search[0].id;
  }

  // 2. Neuen Client anlegen
  const created = await bFetch(
    `/companies/${companyId}/clients`,
    'POST',
    {
      email,
      firstName:      firstName || '',
      lastName:       lastName  || '',
      externalUserID: email,          // E-Mail als stabile externe ID
      ...(phone && { phone }),
    },
    apiKey
  );
  return created.id;
}

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

  const {
    eventKey, eventName, date, time, groupSize,
    pricePerPerson, basePrice,
    drinksFlat, insurance, freefall,
    promoCode,
    firstName, lastName, email, phone,
    companyName, companyStreet, companyZip, companyCity, ustId,
    expiresInDays = 14,
  } = req.body || {};

  if (!eventKey || !date || !time || !groupSize || !email) {
    return res.status(400).json({ error: 'eventKey, date, time, groupSize, email erforderlich' });
  }

  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  // Generate unique ID
  let id, attempts = 0;
  do {
    id = generateId();
    attempts++;
  } while (attempts < 5 && await redis.exists(`bl:${id}`));

  // ── Bookla-Slot vorbuchen ─────────────────────────────────────────────────
  let bookingId = null;
  let clientId  = null;   // außerhalb des try-Blocks, damit wir ihn in Redis speichern können
  const apiKey    = process.env.BOOKLA_API_KEY;
  const companyId = process.env.BOOKLA_COMPANY_ID;

  if (apiKey && companyId) {
    try {
      const berlinDt   = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Berlin' });
      const startTime  = berlinDt.toISO();
      const utcTimeKey = berlinDt.toUTC().toISO().substring(0, 16);
      const spots      = parseInt(groupSize) || 4;
      const from = `${date}T00:00:00Z`;
      const to   = `${date}T23:59:59Z`;

      // ── 1. Bookla-Client suchen oder anlegen ──
      clientId = await findOrCreateClient(
        companyId,
        { email, firstName, lastName, phone },
        apiKey
      ).catch(e => { console.warn('[Bookla] Client anlegen fehlgeschlagen:', e.message); return null; });

      // ── 2. Freie Ressource ermitteln ──
      const availability = await Promise.all(
        RESOURCE_IDS.map(rid =>
          bFetch(
            `/client/companies/${companyId}/services/${SERVICE_ID}/times`,
            'POST',
            { from, to, spots, resourceIDs: [rid] },
            apiKey
          ).catch(() => null)
        )
      );

      let freeResourceId = null;
      for (let i = 0; i < RESOURCE_IDS.length; i++) {
        const data = availability[i];
        if (!data?.times) continue;
        const rid = RESOURCE_IDS[i];
        const slotArr = data.times[rid] || Object.values(data.times).flat() || [];
        const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === utcTimeKey);
        if (match && match.spotsAvailable === match.totalSpots && match.totalSpots > 0) {
          freeResourceId = rid;
          break;
        }
      }

      if (freeResourceId) {
        // ── 3. Buchung anlegen (Merchant API) ──
        const bkData = await bFetch(
          `/companies/${companyId}/bookings`,
          'POST',
          {
            serviceID:  SERVICE_ID,
            resourceID: freeResourceId,
            startTime,
            spots,
            ...(clientId && { clientID: clientId }),
            metaData: {
              notes:         `Admin-Link ${id} — ausstehende Zahlung`,
              paymentStatus: 'pending',
              adminLink:     id,
            },
          },
          apiKey
        );
        bookingId = bkData.id || null;
        console.log('[Bookla] Vorbuchen erfolgreich:', bookingId, 'clientID:', clientId);

        // ── 4. Status auf "pending" setzen (PATCH, nicht PUT!) ──
        // clientID mitsenden damit Bookla den Client nicht leert!
        if (bookingId) {
          const patchResp = await bFetch(
            `/companies/${companyId}/bookings/${bookingId}`,
            'PATCH',
            {
              status: 'pending',
              ...(clientId && { clientID: clientId }),
            },
            apiKey
          ).catch(e => {
            console.warn('[Bookla] Set-pending fehlgeschlagen:', e.message, JSON.stringify(e.details));
            return null;
          });
          if (patchResp) console.log('[Bookla] Status → pending OK');
        }
      } else {
        console.warn('[Bookla] Kein freier Slot für', date, time);
      }
    } catch (e) {
      console.warn('[Bookla] Vorbuchen fehlgeschlagen, Link wird trotzdem erstellt:', e.message, e.details);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const payload = {
    eventKey, eventName, date, time,
    groupSize:      parseInt(groupSize)        || 4,
    pricePerPerson: parseFloat(pricePerPerson) || 35,
    basePrice:      parseFloat(basePrice)      || 40,
    drinksFlat:     !!drinksFlat,
    insurance:      !!insurance,
    freefall:       !!freefall,
    promoCode:      promoCode     || null,
    firstName:      firstName     || '',
    lastName:       lastName      || '',
    email:          email         || '',
    phone:          phone         || '',
    companyName:    companyName   || null,
    companyStreet:  companyStreet || null,
    companyZip:     companyZip    || null,
    companyCity:    companyCity   || null,
    ustId:          ustId         || null,
    bookingId:      bookingId,
    clientId:       clientId,
    createdAt:      new Date().toISOString(),
  };

  const ttlSeconds = Math.min(Math.max(parseInt(expiresInDays) || 14, 1), 30) * 86400;
  await redis.set(`bl:${id}`, JSON.stringify(payload), { ex: ttlSeconds });

  return res.status(200).json({ id, url: `https://booking.turmxgames.de/?b=${id}` });
};
