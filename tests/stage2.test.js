// Zahlungsprüfung Stufe 2: Der Server bestimmt den Betrag (Karte/SEPA/Wallet, PayPal) und prüft Rechnungen
// vor der Buchung. Abweichung → 409, nichts angelegt. Server kann nicht rechnen → Browser-Betrag wie bisher.
// Stripe, PayPal, Bookla, Redis, Resend sind Attrappen.

const mockCreatePI = jest.fn(async p => ({ id: 'pi_test', client_secret: 'cs_test', amount: p.amount }));
jest.mock('stripe', () => () => ({ paymentIntents: { create: mockCreatePI, retrieve: jest.fn(async () => null) } }));

const mockStore = new Map();
jest.mock('@upstash/redis', () => ({
  Redis: class {
    async set(k, v, o = {}) { if (o.nx && mockStore.has(k)) return null; mockStore.set(k, v); return 'OK'; }
    async get(k) { return mockStore.has(k) ? mockStore.get(k) : null; }
    async del(k) { mockStore.delete(k); }
    async lpush() { return 1; } async ltrim() { return 'OK'; } async hincrby() { return 1; }
  },
}));
jest.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'm' }, error: null }) }; } } }));
jest.mock('../api/_lib/drive', () => ({ uploadInvoiceToDrive: async () => {} }));

const handler = require('../api/bookla');
const SERVICE = '8bd533a6-a6a2-4abb-b170-134b6aab74ce';

let promoDefs, ppOrders, ppFail, bookings;
beforeEach(() => {
  mockStore.clear(); mockCreatePI.mockClear();
  delete process.env.PAYCHECK_SERVER_AMOUNT;
  Object.assign(process.env, { BOOKLA_API_KEY: 'k', BOOKLA_COMPANY_ID: 'c', STRIPE_SECRET_KEY: 's', PAYPAL_CLIENT_ID: 'p', PAYPAL_SECRET: 'q', BOOKLA_EXTRA_RESOURCE_ID: 'off' });
  promoDefs = [{ code: 'TURMX10', discountType: 'percent', discountPercent: 10 }];
  ppOrders = []; ppFail = false; bookings = 0;
  global.fetch = jest.fn(async (url, opts = {}) => {
    const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/plugins/promocodes/list')) return res(200, promoDefs);
    if (url.includes('/oauth2/token')) return res(200, { access_token: 't' });
    if (url.endsWith('/v2/checkout/orders')) {
      if (ppFail) return res(500, { name: 'INTERNAL_SERVER_ERROR' });
      ppOrders.push(JSON.parse(opts.body)); return res(201, { id: 'PPORDER1' });
    }
    if (url.includes('/times')) {
      const rid = JSON.parse(opts.body).resourceIDs[0];
      return res(200, { times: { [rid]: [{ startTime: '2026-12-09T15:00:00Z', spotsAvailable: 45, totalSpots: 45 }] } });
    }
    if (url.endsWith('/client/bookings')) { bookings++; return res(200, { id: 'bk' + bookings }); }
    throw new Error('unerwartet: ' + url);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { delete process.env.BOOKLA_EXTRA_RESOURCE_ID; jest.restoreAllMocks(); });

const call = async (action, body) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: { action }, body }, res);
  return res;
};
// Freunde & Familie, Mi 09.12.2026, 8 Personen: 40 + 8 × 28 = 264 €
const order = (o = {}) => ({ event: 'friends', date: '2026-12-09', time: '16:00', qty: 8, extras: {}, promoCode: null, adminLinkId: null, ...o });

describe('Karte / SEPA / Wallet (create-payment-intent)', () => {
  test('Betrag passt → Zahlung mit Server-Betrag', async () => {
    const r = await call('create-payment-intent', { amount: 264, order: order() });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(26400);
  });

  test('Mit Rabattcode (10 %): Server rechnet mit der Code-Definition', async () => {
    const r = await call('create-payment-intent', { amount: 237.6, order: order({ promoCode: 'TURMX10' }) });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(23760);
  });

  test('Manipulierter Betrag (1 €) → 409, keine Zahlung angelegt', async () => {
    const r = await call('create-payment-intent', { amount: 1, order: order() });
    expect(r.code).toBe(409);
    expect(r.body.priceChanged).toBe(true);
    expect(mockCreatePI).not.toHaveBeenCalled();
  });

  test('Code-Definition fehlt → Browser-Betrag wie bisher (nicht blockieren)', async () => {
    promoDefs = [];
    const r = await call('create-payment-intent', { amount: 237.6, order: order({ promoCode: 'TURMX10' }) });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(23760);
  });

  test('Admin-Link → ausgenommen, Browser-Betrag', async () => {
    const r = await call('create-payment-intent', { amount: 999, order: order({ adminLinkId: 'abc123' }) });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(99900);
  });

  test('Ohne Bestellung (alte Seite) → Browser-Betrag', async () => {
    const r = await call('create-payment-intent', { amount: 264 });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(26400);
  });

  test('Schalter aus (PAYCHECK_SERVER_AMOUNT=off) → wie Stufe 1, auch bei Abweichung', async () => {
    process.env.PAYCHECK_SERVER_AMOUNT = 'off';
    const r = await call('create-payment-intent', { amount: 1, order: order() });
    expect(r.code).toBe(200);
    expect(mockCreatePI.mock.calls[0][0].amount).toBe(100);
  });
});

describe('PayPal (create-paypal-order)', () => {
  test('Order mit Server-Betrag, intent AUTHORIZE', async () => {
    const r = await call('create-paypal-order', { amount: 264, order: order(), description: 'TurmX Games – Freunde & Familie' });
    expect(r.code).toBe(200);
    expect(r.body.id).toBe('PPORDER1');
    expect(ppOrders[0]).toMatchObject({ intent: 'AUTHORIZE', purchase_units: [{ amount: { currency_code: 'EUR', value: '264.00' } }] });
  });

  test('Manipulierter Betrag → 409, keine Order', async () => {
    const r = await call('create-paypal-order', { amount: 1, order: order() });
    expect(r.code).toBe(409);
    expect(ppOrders).toHaveLength(0);
  });

  test('PayPal gestört → 502 (Browser legt die Order dann wie bisher selbst an)', async () => {
    ppFail = true;
    const r = await call('create-paypal-order', { amount: 264, order: order() });
    expect(r.code).toBe(502);
  });
});

describe('Rechnung (create-booking-invoice)', () => {
  // Firmen & Teams, Mi 09.12.2026, 10 Personen: 40 + 10 × 35 = 390 €
  const inv = (amount, o = {}) => ({
    serviceId: SERVICE, date: '2026-12-09', time: '16:00', groupSize: 10, firstName: 'Mara', lastName: 'Okafor',
    email: `mara+${amount}@example.de`, notes: 'x', serviceName: 'Firmen & Teams', amount, baseAmount: amount,
    companyName: 'Rheinwerk GmbH', companyStreet: 'Hafenstr. 9', companyZip: '50668', companyCity: 'Köln',
    order: order({ event: 'firma', qty: 10 }), ...o,
  });

  test('Betrag passt → Buchung', async () => {
    const r = await call('create-booking-invoice', inv(390));
    expect(r.code).toBe(201);
    expect(bookings).toBe(1);
  });

  test('Manipulierter Betrag → 409, nicht gebucht, Sperre gelöst', async () => {
    const r = await call('create-booking-invoice', inv(100));
    expect(r.code).toBe(409);
    expect(bookings).toBe(0);
    expect([...mockStore.keys()].some(k => k.startsWith('idemp-inv:'))).toBe(false);
  });
});
