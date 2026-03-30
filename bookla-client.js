/**
 * bookla-client.js
 * Frontend-Modul für die Bookla-Anbindung
 *
 * Einbinden im HTML:
 *   <script src="/bookla-client.js"></script>
 *
 * Funktioniert mit dem bestehenden Widget-State-Objekt "S"
 * und ruft /api/bookla auf (nie direkt Bookla).
 */

const BooklaClient = (() => {

  // ── Konfiguration ───────────────────────────────────────────────────────────
  const API = '/api/bookla'; // Vercel Function

  // Mapping: Widget eventKey → Bookla Service ID
  // ► Diese IDs aus deinem Bookla-Dashboard eintragen!
  const SERVICE_MAP = {
    jga:     'DEINE_BOOKLA_SERVICE_ID_JGA',
    firma:   'DEINE_BOOKLA_SERVICE_ID_FIRMA',
    team:    'DEINE_BOOKLA_SERVICE_ID_TEAM',
    friends: 'DEINE_BOOKLA_SERVICE_ID_FRIENDS',
    kinder:  'DEINE_BOOKLA_SERVICE_ID_KINDER',
    schule:  'DEINE_BOOKLA_SERVICE_ID_SCHULE',
    verein:  'DEINE_BOOKLA_SERVICE_ID_VEREIN',
  };

  // Cache für geladene Daten (vermeidet doppelte Requests)
  const _cache = {};

  // ── Hilfsfunktion: API-Call ─────────────────────────────────────────────────
  async function call(action, body = null) {
    const opts = {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }),
    };
    const res = await fetch(`${API}?action=${action}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
    return data;
  }

  // ── 1. Services laden ───────────────────────────────────────────────────────
  async function loadServices() {
    if (_cache.services) return _cache.services;
    const data = await call('services');
    _cache.services = data;
    return data;
  }

  // ── 2. Service ID für aktuellen eventKey holen ──────────────────────────────
  function getServiceId(eventKey) {
    const id = SERVICE_MAP[eventKey];
    if (!id || id.startsWith('DEINE_')) {
      console.warn(`[BooklaClient] Keine Service-ID für "${eventKey}" konfiguriert`);
      return null;
    }
    return id;
  }

  // ── 3. Verfügbare Tage für Monat laden ─────────────────────────────────────
  // Gibt zurück: Set mit verfügbaren Datum-Strings "YYYY-MM-DD"
  async function loadAvailableDates(eventKey, year, month) {
    const serviceId = getServiceId(eventKey);
    if (!serviceId) return new Set();

    const cacheKey = `dates_${serviceId}_${year}_${month}`;
    if (_cache[cacheKey]) return _cache[cacheKey];

    try {
      const data = await call('available-dates', { serviceId, year, month });
      // Bookla gibt Array von Datum-Strings zurück
      const dates = new Set(Array.isArray(data) ? data : (data.dates || []));
      _cache[cacheKey] = dates;
      return dates;
    } catch (err) {
      console.error('[BooklaClient] loadAvailableDates:', err.message);
      return new Set();
    }
  }

  // ── 4. Verfügbare Uhrzeiten für einen Tag laden ─────────────────────────────
  // Gibt zurück: Array von { time: "14:00", available: true, spots: 12 }
  async function loadAvailableTimes(eventKey, date, groupSize) {
    const serviceId = getServiceId(eventKey);
    if (!serviceId) return [];

    const cacheKey = `times_${serviceId}_${date}_${groupSize}`;
    if (_cache[cacheKey]) return _cache[cacheKey];

    try {
      const data = await call('available-times', { serviceId, date, groupSize });
      // Bookla gibt Array von Time-Slots zurück
      const times = Array.isArray(data) ? data : (data.times || []);
      _cache[cacheKey] = times;
      return times;
    } catch (err) {
      console.error('[BooklaClient] loadAvailableTimes:', err.message);
      return [];
    }
  }

  // ── 5. Stripe Payment Intent erstellen ─────────────────────────────────────
  async function createPaymentIntent(amount, description) {
    return await call('create-payment-intent', { amount, description });
  }

  // ── 6. Buchung finalisieren (nach Zahlung!) ─────────────────────────────────
  async function createBooking(bookingData) {
    return await call('create-booking', bookingData);
  }

  // ── Cache leeren (z.B. nach Monatswechsel) ──────────────────────────────────
  function clearCache(prefix = null) {
    if (prefix) {
      Object.keys(_cache).filter(k => k.startsWith(prefix)).forEach(k => delete _cache[k]);
    } else {
      Object.keys(_cache).forEach(k => delete _cache[k]);
    }
  }

  return { loadServices, getServiceId, loadAvailableDates, loadAvailableTimes, createPaymentIntent, createBooking, clearCache };

})();
