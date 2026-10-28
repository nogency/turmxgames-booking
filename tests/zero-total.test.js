// Buchung ohne Zahlung NUR, wenn ein Gutschein den Betrag wirklich ganz deckt (Server rechnet selbst nach,
// Bookla bestätigt den Code). Review 27.10.2026, Punkt 7. Bookla und Redis sind Attrappen.

const mockStore = new Map();
jest.mock('@upstash/redis', () => ({
  Redis: class {
    async set(k, v, o = {}) { if (o.nx && mockStore.has(k)) return null; mockStore.set(k, v); return 'OK'; }
    async get(k) { return mockStore.has(k) ? mockStore.get(k) : null; }
    async del(k) { mockStore.delete(k); }
    async lpush() { return 1; } async ltrim() { return 'OK'; } async hincrby() { return 1; }
  },
}));

const handler = require('../api/bookla');
const SERVICE = '8bd533a6-a6a2-4abb-b170-134b6aab74ce';

let promoDefs, canApply, bookings;
beforeEach(() => {
  Object.assign(process.env, { BOOKLA_API_KEY: 'k', BOOKLA_COMPANY_ID: 'c' });
  mockStore.clear();
  promoDefs = [{ code: 'GS-ABCD-EFGH', discountType: 'amount', discountAmount: 50000 }];   // 500 €
  canApply = true; bookings = 0;
  global.fetch = jest.fn(async (url, opts = {}) => {
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/plugins/promocodes/list')) return ok(promoDefs);
    if (url.includes('/validate')) return ok({ canApply });
    if (url.includes('/times')) {
      const rid = JSON.parse(opts.body).resourceIDs[0];
      return ok({ times: { [rid]: [{ startTime: '2026-12-09T15:00:00Z', spotsAvailable: 45, totalSpots: 45 }] } });
    }
    if (url.endsWith('/client/bookings')) { bookings++; return ok({ id: 'bk' + bookings }); }
    throw new Error('unerwartet: ' + url);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// Freunde & Familie, Mi 09.12.2026, 8 Personen: 40 + 8 × 28 = 264 € → 500-€-Gutschein deckt alles
const order = (o = {}) => ({ event: 'friends', date: '2026-12-09', time: '16:00', qty: 8, extras: {}, promoCode: 'GS-ABCD-EFGH', adminLinkId: null, ...o });
const body = (o = {}) => ({
  serviceId: SERVICE, date: '2026-12-09', time: '16:00', groupSize: 8, firstName: 'Lena', email: 'lena@example.com',
  notes: 'x', promoCode: 'GS-ABCD-EFGH', paymentIntentId: null, paypalAuthId: null, order: order(), zeroTotal: true, ...o,
});
const call = async b => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: { action: 'create-booking' }, body: b }, res);
  return res;
};

test('Gutschein deckt alles: Buchung ohne Zahlung', async () => {
  const r = await call(body());
  expect(r.code).toBe(201);
  expect(r.body.id).toBe('bk1');
});

test('Gutschein deckt nicht alles: abgelehnt, keine Buchung', async () => {
  promoDefs = [{ code: 'GS-ABCD-EFGH', discountType: 'amount', discountAmount: 5000 }];   // nur 50 €
  const r = await call(body());
  expect(r.code).toBe(402);
  expect(bookings).toBe(0);
});

test('Bookla meldet Code als nicht einlösbar (z. B. schon benutzt): abgelehnt', async () => {
  canApply = false;
  const r = await call(body());
  expect(r.code).toBe(402);
  expect(bookings).toBe(0);
});

test('Bestellung passt nicht zur Buchung (4 bestellt, 30 gebucht): abgelehnt', async () => {
  const r = await call(body({ groupSize: 30, order: order({ qty: 4 }) }));
  expect(r.code).toBe(402);
  expect(bookings).toBe(0);
});

test('Wiederholung nach Erfolg (Antwort verloren): bestehende Buchung, obwohl der Code jetzt eingelöst ist', async () => {
  const first = await call(body());
  expect(first.code).toBe(201);
  canApply = false;                                   // Code ist durch die erste Buchung verbraucht
  const again = await call(body());
  expect(again.code).toBe(200);
  expect(again.body.id).toBe(first.body.id);
  expect(bookings).toBe(1);
});

test('Abgelehnt: Sperre wird gelöst, ein echter Neuversuch ist möglich', async () => {
  canApply = false;
  expect((await call(body())).code).toBe(402);
  canApply = true;
  expect((await call(body())).code).toBe(201);
});

test('Ohne Code: abgelehnt', async () => {
  const r = await call(body({ promoCode: null, order: order({ promoCode: null }) }));
  expect(r.code).toBe(402);
  expect(bookings).toBe(0);
});
