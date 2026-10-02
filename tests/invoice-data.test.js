const { calculateTax, formatInvoiceNumber, formatDate, getDueDate, buildInvoiceData } = require('../api/_lib/invoice-data');

test('calculateTax: 180 EUR brutto splits correctly', () => {
  const { netto, mwst, brutto } = calculateTax(180);
  expect(brutto).toBe(180);
  expect(netto).toBe(151.26);
  expect(mwst).toBe(28.74);
  expect(netto + mwst).toBeCloseTo(180, 1);
});

test('calculateTax: 45 EUR brutto', () => {
  const { netto, mwst, brutto } = calculateTax(45);
  expect(brutto).toBe(45);
  expect(netto + mwst).toBeCloseTo(45, 1);
});

test('formatInvoiceNumber', () => {
  expect(formatInvoiceNumber('251295')).toBe('AB-251295');
  expect(formatInvoiceNumber(251295)).toBe('AB-251295');
});

// ── Gutschein/Rabatt auf der AB (Testbuchung 02.10.2026: Firma, 6 P., Getränke, 25 € Rabatt) ──
const abBase = {
  bookingId: 'x1', serviceName: 'Firmen & Teams', groupSize: 6, amount: 302.4, baseAmount: 225,
  drinksFlat: true, drinksPrice: 12.9, insurance: false, paymentMethod: 'invoice',
  date: '2026-10-06', time: '16:00', firstName: 'A', lastName: 'B', email: 'a@b.de',
};

test('AB ohne Rabattfelder (v1-Frontend): Positionen unverändert', () => {
  const d = buildInvoiceData(abBase);
  expect(d.items.map(i => [i.name, i.tax.brutto])).toEqual([['Firmen & Teams', 225], ['Getränkeflat', 77.4]]);
  expect(d.tax.brutto).toBe(302.4);
});

test('AB mit Gutschein: voller Preis + Minus-Position, Summe gleich', () => {
  const d = buildInvoiceData({ ...abBase, promoCode: 'GS-ABCD-EFGH', discountAmount: 25 });
  expect(d.items.map(i => [i.name, i.qtyLabel, i.tax.brutto])).toEqual([
    ['Firmen & Teams', '6 Pers.', 250], ['Gutschein GS-ABCD-EFGH', '', -25], ['Getränkeflat', '6 Pers.', 77.4],
  ]);
  expect(d.tax.brutto).toBe(302.4);
  expect(d.tax.netto + d.tax.mwst).toBeCloseTo(302.4, 2);
});

test('AB mit Rabattcode: Label, Rabatt 0 erzeugt keine Zeile', () => {
  expect(buildInvoiceData({ ...abBase, promoCode: 'turmx10', discountAmount: 25 }).items[1].name).toBe('Rabattcode TURMX10');
  expect(buildInvoiceData({ ...abBase, promoCode: 'TURMX10', discountAmount: 0 }).items).toHaveLength(2);
});

test('formatDate from ISO string', () => {
  expect(formatDate('2026-02-27')).toBe('27.02.2026');
});

test('getDueDate returns a future date string in DD.MM.YYYY format', () => {
  const due = getDueDate(14);
  expect(due).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  const [d, m, y] = due.split('.').map(Number);
  expect(new Date(y, m - 1, d).getTime()).toBeGreaterThan(Date.now());
});

test('buildInvoiceData assembles all required fields', () => {
  process.env.INVOICE_BANK_OWNER = 'HB Kletterwelten GmbH';
  process.env.INVOICE_BANK_IBAN = 'DE12345678901234567890';
  process.env.INVOICE_BANK_BIC = 'COBADEFFXXX';
  const data = buildInvoiceData({
    bookingId: '251295',
    serviceName: 'Firmen-Teamevents',
    groupSize: 4,
    amount: '180.00',
    paymentMethod: 'invoice',
    date: '2026-02-27',
    time: '11:00',
    firstName: 'Max',
    lastName: 'Mustermann',
    email: 'max@test.de',
  });
  expect(data.invoiceNumber).toBe('AB-251295');
  expect(data.tax.brutto).toBe(180);
  expect(data.isCompany).toBe(false);
  expect(data.bankIban).toBe('DE12345678901234567890');
});
