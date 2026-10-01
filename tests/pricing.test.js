// Preislogik: Werte stammen aus der Messung gegen die Live-Seite (v1) vom 2026-09-29/30.
// Ändert sich ein Wert, ist das eine Preisänderung und muss bewusst passieren.
const P = require('../shared/pricing');

const MO = 1, FR = 5, SA = 6;
const q = (event, dow, qty, extras = {}, promoDef = null, override = null) =>
  P.quote({ event, dow, qty, extras, promoDef, override }).total;
const pct = v => ({ discountType: 'percent', discountValue: v, maxDiscountCents: null });

describe('Tagespreise (4 Personen, ohne Extras)', () => {
  test.each([
    ['jga', 152, 160, 180],
    ['friends', 152, 160, 180],
    ['firma', 180, 180, 180],
    ['kinder', 156, 156, 180],
    ['schule', 100, 100, 100],
    ['verein', 100, 100, 100],
  ])('%s Mo/Fr/Sa', (ev, mo, fr, sa) => {
    expect([q(ev, MO, 4), q(ev, FR, 4), q(ev, SA, 4)]).toEqual([mo, fr, sa]);
  });

  test('ohne Datum = Wochentagspreis', () => {
    expect(P.ppForDay('jga', null)).toBe(28);
    expect(P.ppForDay('kinder', null)).toBe(24);
    expect(P.ppForDay('firma', null)).toBe(35);
  });
});

describe('Extras', () => {
  test('JGA Sa 8 P. mit Getränken und Freefall', () => {
    const r = P.quote({ event: 'jga', dow: SA, qty: 8, extras: { drinks: true, freefall: true } });
    expect(r.total).toBe(453.2);
    expect(r.vat).toBe(72.36);
  });
  test('Kinder Sa 8 mit Getränken (7,90 €)', () => expect(q('kinder', SA, 8, { drinks: true })).toBe(363.2));
  test('Versicherung pauschal', () => expect(q('jga', MO, 4, { insurance: true })).toBe(166.9));
  test('Freefall nur beim JGA', () => expect(q('friends', SA, 4, { freefall: true })).toBe(180));
});

describe('Rabatt- und Gutscheincodes (nur auf Grundgebühr + Personen)', () => {
  test('10 % JGA Mo', () => expect(q('jga', MO, 4, {}, pct(10))).toBe(136.8));
  test('10 % JGA Mo, 5 Personen', () => expect(q('jga', MO, 5, {}, pct(10))).toBe(162));
  test('20 € fest', () => expect(q('jga', MO, 4, {}, { discountType: 'amount', discountValue: 2000 })).toBe(132));
  test('50 % gedeckelt auf 30 €', () => expect(q('jga', SA, 4, {}, { discountType: 'percent', discountValue: 50, maxDiscountCents: 3000 })).toBe(150));
  test('Schule Sa 50 % gedeckelt', () => expect(q('schule', SA, 4, {}, { discountType: 'percent', discountValue: 50, maxDiscountCents: 3000 })).toBe(70));
  test('Kinder Mo 10 %', () => expect(q('kinder', MO, 4, {}, pct(10))).toBe(140.4));
  test('Extras bleiben ungekürzt', () => expect(q('jga', MO, 4, { drinks: true }, pct(10))).toBe(188.4));
  test('Gutschein größer als Preis', () => {
    const big = { discountType: 'amount', discountValue: 50000 };
    expect(q('jga', MO, 4, {}, big)).toBe(0);
    expect(q('jga', MO, 4, { drinks: true }, big)).toBe(51.6);
  });
});

describe('Admin-Link mit eigenen Preisen', () => {
  test('Override Grundgebühr + Personenpreis', () => {
    expect(q('firma', FR, 24, { drinks: true }, null, { base: 0, pp: 30 })).toBe(1029.6);
  });
});
