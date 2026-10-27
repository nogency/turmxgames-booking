// Gutschein-Shop: Eine bezahlte Zahlung darf NIE einen zweiten Gutschein erzeugen – auch nicht nach Tagen.
// (Review 27.10.2026: vorher lief die Sperre nach 24 h ab.) Stripe, PayPal, Redis, Bookla und Resend sind Attrappen.

const mockPI = { retrieve: jest.fn(), update: jest.fn() };
jest.mock('stripe', () => () => ({ paymentIntents: mockPI }));

const mockRedis = { data: new Map(), opts: new Map() };
jest.mock('@upstash/redis', () => ({
  Redis: class {
    async set(k, v, o = {}) {
      if (o.nx && mockRedis.data.has(k)) return null;
      mockRedis.data.set(k, v); mockRedis.opts.set(k, o); return 'OK';
    }
    async get(k) { return mockRedis.data.has(k) ? mockRedis.data.get(k) : null; }
    async del(k) { mockRedis.data.delete(k); }
  },
}));
const mockSend = jest.fn(async () => ({ data: { id: 'm1' }, error: null }));
jest.mock('resend', () => ({ Resend: class { constructor() { this.emails = { send: mockSend }; } } }));
jest.mock('../api/_lib/giftcard-pdf', () => ({ generateGiftcardPDF: async () => Buffer.from('%PDF-') }));
jest.mock('../api/_lib/drive', () => ({ uploadInvoiceToDrive: async () => {} }));

const handler = require('../api/giftcard');

let paypalAuth, booklaCreates;
beforeEach(() => {
  Object.assign(process.env, { BOOKLA_API_KEY: 'k', BOOKLA_COMPANY_ID: 'c', STRIPE_SECRET_KEY: 's', PAYPAL_CLIENT_ID: 'p', PAYPAL_SECRET: 'q' });
  mockRedis.data.clear(); mockRedis.opts.clear();
  mockPI.retrieve.mockReset(); mockPI.update.mockReset().mockResolvedValue({});
  mockSend.mockClear();
  booklaCreates = 0;
  paypalAuth = { status: 'CREATED', amount: { value: '50.00', currency_code: 'EUR' } };
  global.fetch = jest.fn(async (url, opts = {}) => {
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/plugins/promocodes/list')) { booklaCreates++; return ok({}); }
    if (url.includes('/oauth2/token')) return ok({ access_token: 't' });
    if (url.endsWith('/capture')) { paypalAuth.status = 'CAPTURED'; return ok({}); }
    if (url.includes('/v2/payments/authorizations/')) return ok(paypalAuth);
    throw new Error('unerwartet: ' + url);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const call = async body => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: { action: 'finalize' }, body }, res);
  return res;
};
const buyer = { firstName: 'Lena', lastName: 'Brückner', email: 'lena@example.com' };
const stripePI = (meta = {}) => ({ id: 'pi_1', status: 'succeeded', amount: 5000, metadata: { kind: 'giftcard', giftAmountCents: '5000', giftType: 'digital', ...meta } });

test('Stripe: Gutschein entsteht, Sperre ohne Ablauf, Code steht an der Zahlung', async () => {
  mockPI.retrieve.mockResolvedValue(stripePI());
  const r = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  expect(r.code).toBe(201);
  expect(r.body.code).toMatch(/^GS-/);
  expect(JSON.parse(mockRedis.data.get('gc:pi_1')).status).toBe('done');
  expect(mockRedis.opts.get('gc:pi_1').ex).toBeUndefined();          // kein 24-h-Ablauf mehr
  expect(mockPI.update).toHaveBeenCalledWith('pi_1', { metadata: { giftCode: r.body.code } });
});

test('Stripe: Redis-Eintrag weg, Code an der Zahlung → derselbe Gutschein, kein zweiter', async () => {
  mockPI.retrieve.mockResolvedValue(stripePI({ giftCode: 'GS-AAAA-BBBB' }));
  const r = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  expect(r.code).toBe(200);
  expect(r.body).toMatchObject({ code: 'GS-AAAA-BBBB', duplicate: true });
  expect(booklaCreates).toBe(0);
});

test('Stripe: zweiter Aufruf mit Redis-Eintrag → derselbe Gutschein', async () => {
  mockPI.retrieve.mockResolvedValue(stripePI());
  const first = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  const second = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  expect(second.body).toMatchObject({ code: first.body.code, duplicate: true });
  expect(booklaCreates).toBe(1);
});

test('PayPal: normal einziehen und Gutschein anlegen', async () => {
  const r = await call({ paypalAuthId: 'A1', type: 'digital', buyer });
  expect(r.code).toBe(201);
  expect(booklaCreates).toBe(1);
  expect(mockRedis.opts.get('gc:A1').ex).toBeUndefined();
});

test('PayPal: schon eingezogen, aber kein Gutschein vermerkt → keiner automatisch, Hinweis an euch', async () => {
  paypalAuth.status = 'CAPTURED';
  const r = await call({ paypalAuthId: 'A1', type: 'digital', buyer });
  expect(r.code).toBe(409);
  expect(booklaCreates).toBe(0);
  expect(mockSend).toHaveBeenCalled();                                // Admin-Hinweis
  expect(JSON.parse(mockRedis.data.get('gc:A1')).status).toBe('failed');
});
