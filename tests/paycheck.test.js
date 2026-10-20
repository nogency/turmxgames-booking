// Zahlungsprüfung Stufe 1 (nur beobachten): reine Logik ohne Netzwerk.
const pc = require('../api/_lib/paycheck');

const order = (o = {}) => ({ event: 'jga', date: '2026-10-05', time: '16:00', qty: 4, extras: {}, promoCode: null, ...o });   // Mo
const norm = o => pc.normalizeOrder(order(o)).order;

describe('Bestellung prüfen', () => {
  test('gültige Bestellung wird vereinheitlicht', () => {
    expect(norm({ promoCode: ' turmx10 ', extras: { drinks: 1 } })).toEqual({
      event: 'jga', date: '2026-10-05', time: '16:00', qty: 4,
      extras: { drinks: true, insurance: false, freefall: false }, promoCode: 'TURMX10', adminLinkId: null,
    });
  });
  test.each([
    [{ event: 'xyz' }, 'unbekanntes Event'],
    [{ date: '05.10.2026' }, 'Datum ungültig'],
    [{ time: '16' }, 'Uhrzeit ungültig'],
    [{ qty: 3 }, 'Personenzahl ungültig'],
    [{ qty: 33 }, 'Personenzahl ungültig'],
  ])('ungültig: %o', (o, err) => expect(pc.normalizeOrder(order(o)).error).toBe(err));
  test('fehlende Bestellung (alte Seite)', () => expect(pc.normalizeOrder(undefined).error).toBe('keine Bestellung mitgeschickt'));
  test('Freefall zählt nur beim JGA', () => expect(norm({ event: 'firma', extras: { freefall: true } }).extras.freefall).toBe(false));
});

describe('Fingerabdruck', () => {
  test('stabil und abhängig vom Inhalt', () => {
    expect(pc.orderHash(norm())).toBe(pc.orderHash(norm()));
    expect(pc.orderHash(norm())).not.toBe(pc.orderHash(norm({ qty: 32 })));
    expect(pc.orderHash(norm())).toHaveLength(24);
  });
});

describe('Erwarteter Preis (identisch zum Browser)', () => {
  const total = (o, opts) => pc.expectedQuote(norm(o), opts).total;
  test('JGA Sa 8 P. Getränke + Freefall', () => expect(total({ date: '2026-10-10', qty: 8, extras: { drinks: true, freefall: true } })).toBe(453.2));
  test('Kleingruppe JGA Mo 4 P.', () => expect(total({})).toBe(201.99));
  test('mit 10-%-Code', () => expect(total({ promoCode: 'TURMX10' }, { promoDef: { discountType: 'percent', discountValue: 10 } })).toBe(186.79));
  test('Admin-Link: Preise und Umfang aus dem Link', () => {
    const link = { eventKey: 'firma', date: '2026-10-09', groupSize: 24, pricePerPerson: 30, basePrice: 40, drinksFlat: true };
    expect(pc.expectedQuote(null, { link }).total).toBe(1069.6);   // 40 + 24 × 30 + 24 × 12,90
  });
});

describe('Zahlung einordnen', () => {
  const hash = pc.orderHash(norm());
  const pi = (p = {}) => ({ amount: 20199, currency: 'eur', status: 'succeeded', metadata: { kind: 'booking', orderHash: hash }, ...p });
  test('Stripe korrekt', () => expect(pc.classifyStripe(pi(), 20199, hash).result).toBe('ok'));
  test('Stripe SEPA in Bearbeitung ist ok', () => expect(pc.classifyStripe(pi({ status: 'processing' }), 20199, hash).result).toBe('ok'));
  test('Stripe zu niedriger Betrag', () => expect(pc.classifyStripe(pi({ amount: 100 }), 20199, hash).issues).toEqual(['Betrag 100 statt 20199']));
  test('Stripe nicht bezahlt', () => expect(pc.classifyStripe(pi({ status: 'requires_payment_method' }), 20199, hash).result).toBe('abweichung'));
  test('Stripe-Zahlung eines Gutscheins', () => expect(pc.classifyStripe(pi({ metadata: { kind: 'giftcard' } }), 20199, hash).issues).toEqual(['Zahlung für giftcard']));
  test('Stripe-Zahlung einer anderen Bestellung', () => expect(pc.classifyStripe(pi({ metadata: { kind: 'booking', orderHash: 'x' } }), 20199, hash).issues).toEqual(['Zahlung gehört zu anderer Bestellung']));
  test('Stripe ohne Zahlung', () => expect(pc.classifyStripe(null, 20199, hash).result).toBe('keine-zahlung'));
  const auth = (a = {}) => ({ status: 'CREATED', amount: { value: '201.99', currency_code: 'EUR' }, ...a });
  test('PayPal korrekt', () => expect(pc.classifyPaypal(auth(), 20199).result).toBe('ok'));
  test('PayPal falscher Betrag', () => expect(pc.classifyPaypal(auth({ amount: { value: '1.00', currency_code: 'EUR' } }), 20199).issues).toEqual(['Betrag 100 statt 20199']));
  test('Betrag vom Browser', () => {
    expect(pc.classifyAmount(201.99, 20199).result).toBe('ok');
    expect(pc.classifyAmount(1, 20199).issues).toEqual(['Betrag 100 statt 20199']);
  });
});

describe('Prüfung mit Abhängigkeiten (ohne Netzwerk)', () => {
  const deps = extra => ({
    getPromoDef: async code => (code === 'TURMX10' ? { discountType: 'percent', discountValue: 10 } : null),
    getLink: async () => null,
    getStripePI: async id => (id === 'pi_ok' ? { amount: 18679, currency: 'eur', status: 'requires_capture', metadata: {} } : null),
    getPaypalAuth: async () => null,
    ...extra,
  });
  test('Stripe mit Code: ok', async () => {
    const e = await pc.evaluate({ stage: 'buchung', rawOrder: order({ promoCode: 'TURMX10' }), paymentIntentId: 'pi_ok', deps: deps() });
    expect([e.result, e.expectedCents, e.actualCents, e.method]).toEqual(['ok', 18679, 18679, 'stripe']);
    expect(e.order).toEqual({ event: 'jga', date: '2026-10-05', time: '16:00', qty: 4, extras: '-', promo: 'TURMX10', link: null });
  });
  test('ohne Zahlung', async () => {
    const e = await pc.evaluate({ stage: 'buchung', rawOrder: order(), deps: deps() });
    expect(e.result).toBe('keine-zahlung');
  });
  test('alte Seite ohne Bestellung', async () => {
    const e = await pc.evaluate({ stage: 'zahlung-anlegen', rawOrder: undefined, clientAmount: 152, deps: deps() });
    expect([e.result, e.actualCents]).toEqual(['ohne-bestellung', 15200]);
  });
  test('Fehler in einer Abhängigkeit wird protokolliert, nicht geworfen', async () => {
    const e = await pc.evaluate({ stage: 'buchung', rawOrder: order(), paymentIntentId: 'x', deps: deps({ getStripePI: async () => { throw new Error('Stripe down'); } }) });
    expect([e.result, e.issues]).toEqual(['fehler', ['Stripe down']]);
  });
});

describe('Abschluss: doppelt verwendete Zahlung', () => {
  const fakeRedis = () => {
    const kv = new Map(), log = [];
    return {
      log,
      set: async (k, v, o) => { if (o && o.nx && kv.has(k)) return null; kv.set(k, v); return 'OK'; },
      get: async k => kv.get(k) ?? null,
      lpush: async (k, v) => { log.unshift(JSON.parse(v)); },
      ltrim: async () => {}, hincrby: async () => {},
    };
  };
  test('zweite Buchung mit derselben Zahlung fällt auf', async () => {
    const redis = fakeRedis();
    const entry = () => Promise.resolve({ stage: 'buchung', result: 'ok', ref: 'pi_1', issues: [] });
    await pc.finish(entry(), { stage: 'buchung', bookingId: 'b1', deps: { redis } });
    await pc.finish(entry(), { stage: 'buchung', bookingId: 'b1', deps: { redis } });   // Wiederholung derselben Buchung: ok
    await pc.finish(entry(), { stage: 'buchung', bookingId: 'b2', deps: { redis } });
    expect(redis.log.map(l => l.result)).toEqual(['abweichung', 'ok', 'ok']);
    expect(redis.log[0].issues).toEqual(['Zahlung schon für Buchung b1 verwendet']);
  });
  test('Zeitlimit wird protokolliert, nicht gewartet', async () => {
    const redis = fakeRedis();
    await pc.finish(new Promise(() => {}), { stage: 'buchung', bookingId: 'b3', deps: { redis }, timeoutMs: 20 });
    expect(redis.log[0].result).toBe('zeitlimit');
  });
});
