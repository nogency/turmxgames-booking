// Preislogik: Werte stammen aus der Messung gegen die Live-Seite (v1) vom 2026-09-29/30.
// Ändert sich ein Wert, ist das eine Preisänderung und muss bewusst passieren.
// 13.10.2026: Kleingruppenzuschlag 49,99 € bei 4–5 Personen → Werte mit 4/5 Personen als "alt + Z".
const P = require('../shared/pricing');

const MO = 1, FR = 5, SA = 6;
const Z = 49.99;
const r2 = n => Math.round(n * 100) / 100;
const q = (event, dow, qty, extras = {}, promoDef = null, override = null) =>
  P.quote({ event, dow, qty, extras, promoDef, override }).total;
const pct = v => ({ discountType: 'percent', discountValue: v, maxDiscountCents: null });

describe('Tagespreise (4 Personen, ohne Extras, inkl. Kleingruppenzuschlag)', () => {
  test.each([
    ['jga', 152, 160, 180],
    ['friends', 152, 160, 180],
    ['firma', 180, 180, 180],
    ['kinder', 156, 156, 180],
    ['schule', 100, 100, 100],
    ['verein', 100, 100, 100],
  ])('%s Mo/Fr/Sa', (ev, mo, fr, sa) => {
    expect([q(ev, MO, 4), q(ev, FR, 4), q(ev, SA, 4)]).toEqual([mo, fr, sa].map(v => r2(v + Z)));
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
  test('Versicherung pauschal', () => expect(q('jga', MO, 4, { insurance: true })).toBe(r2(166.9 + Z)));
  test('Freefall nur beim JGA', () => expect(q('friends', SA, 4, { freefall: true })).toBe(r2(180 + Z)));
});

describe('Rabatt- und Gutscheincodes (nur auf Grundgebühr + Personen)', () => {
  test('10 % JGA Mo', () => expect(q('jga', MO, 4, {}, pct(10))).toBe(r2(136.8 + Z)));
  test('10 % JGA Mo, 5 Personen', () => expect(q('jga', MO, 5, {}, pct(10))).toBe(r2(162 + Z)));
  test('20 € fest', () => expect(q('jga', MO, 4, {}, { discountType: 'amount', discountValue: 2000 })).toBe(r2(132 + Z)));
  test('50 % gedeckelt auf 30 €', () => expect(q('jga', SA, 4, {}, { discountType: 'percent', discountValue: 50, maxDiscountCents: 3000 })).toBe(r2(150 + Z)));
  test('Schule Sa 50 % gedeckelt', () => expect(q('schule', SA, 4, {}, { discountType: 'percent', discountValue: 50, maxDiscountCents: 3000 })).toBe(r2(70 + Z)));
  test('Kinder Mo 10 %', () => expect(q('kinder', MO, 4, {}, pct(10))).toBe(r2(140.4 + Z)));
  test('Extras bleiben ungekürzt', () => expect(q('jga', MO, 4, { drinks: true }, pct(10))).toBe(r2(188.4 + Z)));
  test('Gutschein größer als Preis', () => {
    const big = { discountType: 'amount', discountValue: 50000 };
    expect(q('jga', MO, 4, {}, big)).toBe(Z);
    expect(q('jga', MO, 4, { drinks: true }, big)).toBe(r2(51.6 + Z));
  });
});

describe('Kleingruppenzuschlag (unter 6 Personen)', () => {
  test('4 und 5 Personen: 49,99 € als eigene Position, ab 6 keiner', () => {
    const at = qty => P.quote({ event: 'jga', dow: MO, qty, extras: {} });
    expect([at(4).smallGroupFee, at(5).smallGroupFee, at(6).smallGroupFee, at(32).smallGroupFee]).toEqual([Z, Z, 0, 0]);
    expect(at(5).lines.find(l => l.key === 'smallgroup')).toEqual({ key: 'smallgroup', amount: Z });
    expect(at(6).lines.some(l => l.key === 'smallgroup')).toBe(false);
    expect(at(5).total).toBe(229.99);   // 40 + 5 × 28 + 49,99
    expect(at(6).total).toBe(208);      // 40 + 6 × 28
  });
  test('gilt für alle Eventarten', () => {
    ['jga', 'firma', 'friends', 'kinder', 'schule', 'verein']
      .forEach(ev => expect(P.quote({ event: ev, dow: SA, qty: 5, extras: {} }).smallGroupFee).toBe(Z));
  });
  test('wird nicht rabattiert und steckt in der MwSt.', () => {
    const r = P.quote({ event: 'jga', dow: MO, qty: 4, extras: {}, promoDef: pct(100) });
    expect(r.total).toBe(Z);
    expect(r.vat).toBe(7.98);
  });
  test('Admin-Link mit eigenen Preisen: kein Zuschlag', () => {
    expect(P.quote({ event: 'jga', dow: MO, qty: 4, extras: {}, override: { base: 40, pp: 30 } }).smallGroupFee).toBe(0);
    expect(q('jga', MO, 4, {}, null, { base: 40, pp: 30 })).toBe(160);
  });
});

describe('Admin-Link mit eigenen Preisen', () => {
  test('Override Grundgebühr + Personenpreis', () => {
    expect(q('firma', FR, 24, { drinks: true }, null, { base: 0, pp: 30 })).toBe(1029.6);
  });
});

// 22.10.2026: AGB §5 – bis 14 Tage vorher frei, 13–7 Tage 50 %, weniger als 7 Tage 100 %
describe('Stornostaffel mit Daten', () => {
  const EV = '2026-12-09';   // Mittwoch

  test('früh gebucht: alle drei Stufen, Grenzen inklusive', () => {
    expect(P.stornoTiers(EV, '2026-10-22')).toEqual([
      { from: null, until: '2026-11-25', pct: 0 },
      { from: '2026-11-26', until: '2026-12-02', pct: 50 },
      { from: '2026-12-03', until: null, pct: 100 },
    ]);
    expect(P.stornoLines(EV, '2026-10-22')).toEqual([
      'Bis 25.11.2026: kostenfrei',
      '26.11.2026 bis 02.12.2026: Stornogebühr 50 % des Buchungsbetrags',
      'Ab 03.12.2026: Stornogebühr 100 % des Buchungsbetrags (keine Erstattung)',
    ]);
  });

  test('am letzten freien Tag gebucht: freie Stufe bleibt', () => {
    expect(P.stornoTiers(EV, '2026-11-25').map(t => t.pct)).toEqual([0, 50, 100]);
  });

  test('kurzfristig (10 Tage vorher): ohne freie Stufe, 50 % ab sofort', () => {
    expect(P.stornoLines(EV, '2026-11-29')).toEqual([
      'Bis 02.12.2026: Stornogebühr 50 % des Buchungsbetrags',
      'Ab 03.12.2026: Stornogebühr 100 % des Buchungsbetrags (keine Erstattung)',
    ]);
  });

  test('sehr kurzfristig (3 Tage vorher): nur 100 % ab sofort', () => {
    expect(P.stornoLines(EV, '2026-12-06')).toEqual(['Ab sofort: Stornogebühr 100 % des Buchungsbetrags (keine Erstattung)']);
  });

  test('über Monats- und Jahresgrenze', () => {
    expect(P.stornoTiers('2027-01-05', '2026-11-01')).toEqual([
      { from: null, until: '2026-12-22', pct: 0 },
      { from: '2026-12-23', until: '2026-12-29', pct: 50 },
      { from: '2026-12-30', until: null, pct: 100 },
    ]);
  });

  test('Umbuchung und Nichterscheinen stehen dabei', () => {
    expect(P.STORNO_NOTES.join(' ')).toMatch(/Nach einer Umbuchung ist keine Stornierung mehr möglich/);
    expect(P.STORNO_NOTES.join(' ')).toMatch(/Nichterscheinen/);
  });
});
