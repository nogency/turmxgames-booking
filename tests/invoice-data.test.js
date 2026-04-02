const { calculateTax, formatInvoiceNumber, formatDate, getDueDate, buildInvoiceData } = require('../api/lib/invoice-data');

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
  expect(formatInvoiceNumber('251295')).toBe('RE-251295');
  expect(formatInvoiceNumber(251295)).toBe('RE-251295');
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
  expect(data.invoiceNumber).toBe('RE-251295');
  expect(data.tax.brutto).toBe(180);
  expect(data.isCompany).toBe(false);
  expect(data.bankIban).toBe('DE12345678901234567890');
});
