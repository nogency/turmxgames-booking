// Auftragsbestätigung als PDF: entsteht ohne Fehler, Storno-Kasten passt auch im vollsten Fall.
// Die erzeugten PDFs landen in pdf-preview/ und werden in der CI als Artefakt hochgeladen (zum Ansehen).
const fs = require('fs');
const path = require('path');
const { buildInvoiceData } = require('../api/_lib/invoice-data');
const { generateInvoicePDF } = require('../api/_lib/pdf');

const OUT = path.join(__dirname, '..', 'pdf-preview');
const pages = buf => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const base = {
  bookingId: '0a21faf8-58bc-4b72-acf9-5955b97d150f', serviceName: 'Freunde & Familie', groupSize: 7,
  amount: 236, baseAmount: 236, paymentMethod: 'cc', date: '2026-12-29', time: '16:00',
  firstName: 'Lena', lastName: 'Brückner', email: 'lena@example.com', phone: '0151 2345678',
};

// Vollster Fall: Firma mit Adresse + USt-ID, Rechnung mit Bankdaten, alle Positionen
const full = {
  ...base, serviceName: 'Firmen & Teams', groupSize: 5, amount: 334.39, baseAmount: 175, paymentMethod: 'invoice',
  date: '2026-12-09', companyName: 'Rheinwerk Logistik GmbH', companyStreet: 'Industriestraße 112',
  companyZip: '50321', companyCity: 'Brühl', ustId: 'DE287364512',
  promoCode: 'GS-ABCD-EFGH', discountAmount: 40, smallGroupFee: 49.99,
  drinksFlat: true, drinksPrice: 12.9, insurance: true, freefall: true,
};

beforeAll(() => fs.mkdirSync(OUT, { recursive: true }));

test.each([
  ['karte-normal', base, '2026-10-22'],
  ['rechnung-alles', full, '2026-10-22'],
  ['karte-kurzfristig', { ...base, date: '2026-10-27' }, '2026-10-22'],
])('PDF %s', async (name, params, today) => {
  const buf = await generateInvoicePDF(buildInvoiceData(params, { today }));
  expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  expect(pages(buf)).toBeGreaterThanOrEqual(1);
  expect(pages(buf)).toBeLessThanOrEqual(2);
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), buf);
});
