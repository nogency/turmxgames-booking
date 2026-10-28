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
  mockSend.mockReset().mockImplementation(async () => ({ data: { id: 'm1' }, error: null }));
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

// ── Versand wiederaufnehmbar (Nachprüfung 28.10.2026) ──
const subjects = () => mockSend.mock.calls.map(c => c[0].subject);
const rec = k => JSON.parse(mockRedis.data.get(k));

test('Käufer-Mail scheitert (Resend liefert error): Wiederholung holt sie nach, kein zweiter Code', async () => {
  mockPI.retrieve.mockResolvedValue(stripePI());
  mockSend.mockImplementation(async m => (m.subject.includes('Dein TurmX Games Gutschein') ? { data: null, error: { message: 'rate limit' } } : { data: { id: 'x' }, error: null }));
  const first = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  expect(first.code).toBe(201);
  expect(rec('gc:pi_1')).toMatchObject({ buyerSent: false });
  expect(subjects().some(s => s.includes('GUTSCHEIN-PROBLEM'))).toBe(true);           // Hinweis an euch

  mockSend.mockClear().mockImplementation(async () => ({ data: { id: 'x' }, error: null }));
  const second = await call({ paymentIntentId: 'pi_1', type: 'digital', buyer });
  expect(second.body).toMatchObject({ code: first.body.code, duplicate: true });
  expect(subjects().filter(s => s.includes('Dein TurmX Games Gutschein'))).toHaveLength(1);
  expect(rec('gc:pi_1')).toMatchObject({ buyerSent: true, hardcopySent: true });
  expect(rec('gc:pi_1').buyer).toBeUndefined();                                         // persönliche Daten wieder weg
  expect(booklaCreates).toBe(1);
});

test('Hardcopy: Auftrag an euch klappt, Käufer-Mail nicht → Wiederholung schickt NUR die Käufer-Mail', async () => {
  mockPI.retrieve.mockResolvedValue({ ...stripePI({ giftType: 'hardcopy' }), amount: 5295 });
  const shipping = { street: 'Kurfürstenstr. 60', zip: '50321', city: 'Brühl' };
  mockSend.mockImplementation(async m => (m.subject.includes('Dein TurmX Games Gutschein') ? { data: null, error: { message: 'down' } } : { data: { id: 'x' }, error: null }));
  await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping });
  expect(rec('gc:pi_1')).toMatchObject({ buyerSent: false, hardcopySent: true });

  mockSend.mockClear().mockImplementation(async () => ({ data: { id: 'x' }, error: null }));
  await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping });
  expect(subjects().filter(s => s.includes('Hardcopy-Gutschein versenden'))).toHaveLength(0);   // kein doppelter Versandauftrag
  expect(subjects().filter(s => s.includes('Dein TurmX Games Gutschein'))).toHaveLength(1);
});

test('Hardcopy-Auftrag scheitert: Wiederholung holt ihn nach (Adresse aus dem gespeicherten Stand)', async () => {
  mockPI.retrieve.mockResolvedValue({ ...stripePI({ giftType: 'hardcopy' }), amount: 5295 });
  const shipping = { street: 'Kurfürstenstr. 60', zip: '50321', city: 'Brühl' };
  mockSend.mockImplementation(async m => (m.subject.includes('Hardcopy-Gutschein versenden') ? { data: null, error: { message: 'down' } } : { data: { id: 'x' }, error: null }));
  await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping });
  expect(rec('gc:pi_1')).toMatchObject({ buyerSent: true, hardcopySent: false });

  mockSend.mockClear().mockImplementation(async () => ({ data: { id: 'x' }, error: null }));
  await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping });
  const hc = mockSend.mock.calls.find(c => c[0].subject.includes('Hardcopy-Gutschein versenden'));
  expect(hc[0].html).toContain('Kurfürstenstr. 60');
  expect(subjects().filter(s => s.includes('Dein TurmX Games Gutschein'))).toHaveLength(0);       // Käufer bekommt keine zweite Mail
  expect(rec('gc:pi_1').shipping).toBeUndefined();
});

// ── Versand 4,95 € und Motiv (28.10.2026) ──
test('Stripe Hardcopy neu: 4,95 € Versand aus der Zahlung, Motiv Weihnachten im Versandauftrag', async () => {
  mockPI.retrieve.mockResolvedValue({ ...stripePI({ giftType: 'hardcopy', shippingCents: '495', giftMotif: 'xmas' }), amount: 5495 });
  const r = await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping: { street: 'A 1', zip: '50321', city: 'Brühl' } });
  expect(r.code).toBe(201);
  const hc = mockSend.mock.calls.find(c => c[0].subject.includes('Hardcopy-Gutschein versenden'));
  expect(hc[0].subject).toContain('Motiv Weihnachten');
  expect(hc[0].html).toContain('Gameshow zum Auspacken');
});

test('Stripe Hardcopy von vor der Umstellung (ohne shippingCents, 2,95 €) wird weiter angenommen', async () => {
  mockPI.retrieve.mockResolvedValue({ ...stripePI({ giftType: 'hardcopy' }), amount: 5295 });
  const r = await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping: { street: 'A 1', zip: '50321', city: 'Brühl' } });
  expect(r.code).toBe(201);
});

test('Stripe Hardcopy: Betrag passt nicht zu den Versandkosten → abgelehnt, kein Code', async () => {
  mockPI.retrieve.mockResolvedValue({ ...stripePI({ giftType: 'hardcopy', shippingCents: '495' }), amount: 5295 });
  const r = await call({ paymentIntentId: 'pi_1', type: 'hardcopy', buyer, shipping: { street: 'A 1', zip: '50321', city: 'Brühl' } });
  expect(r.code).toBe(400);
  expect(booklaCreates).toBe(0);
});

test('PayPal Hardcopy: 54,95 € bezahlt → Gutschein 50 €, unbekanntes Motiv wird Standard', async () => {
  paypalAuth.amount.value = '54.95';
  const r = await call({ paypalAuthId: 'A1', type: 'hardcopy', motif: '<script>', buyer, shipping: { street: 'A 1', zip: '50321', city: 'Brühl' } });
  expect(r.code).toBe(201);
  expect(r.body.amount).toBe(50);
  expect(mockSend.mock.calls.find(c => c[0].subject.includes('Hardcopy')).at(0).subject).toContain('Motiv Standard');
});

test('create-payment Hardcopy: Betrag inkl. 4,95 €, Versand und Motiv in den Stripe-Metadaten', async () => {
  const create = jest.fn(async () => ({ id: 'pi_new', client_secret: 'cs' }));
  mockPI.create = create;
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: { action: 'create-payment' }, body: { amount: 50, type: 'hardcopy', motif: 'xmas' } }, res);
  expect(res.code).toBe(200);
  expect(create.mock.calls[0][0]).toMatchObject({ amount: 5495, metadata: { giftType: 'hardcopy', shippingCents: '495', giftMotif: 'xmas' } });
});

test('PayPal: schon eingezogen, aber kein Gutschein vermerkt → keiner automatisch, Hinweis an euch', async () => {
  paypalAuth.status = 'CAPTURED';
  const r = await call({ paypalAuthId: 'A1', type: 'digital', buyer });
  expect(r.code).toBe(409);
  expect(booklaCreates).toBe(0);
  expect(mockSend).toHaveBeenCalled();                                // Admin-Hinweis
  expect(JSON.parse(mockRedis.data.get('gc:A1')).status).toBe('failed');
});
