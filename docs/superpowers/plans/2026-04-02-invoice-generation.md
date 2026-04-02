# Invoice Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically generate and email a formal PDF invoice (with Netto/MwSt breakdown) after every booking, and add "Auf Rechnung" as a payment option.

**Architecture:** A new `api/invoice.js` Vercel endpoint handles invoice generation using pdfkit and sends the PDF via Resend. Pure helper functions in `api/lib/` are unit-tested with Jest. The frontend calls this endpoint after card/PayPal payment; for "Auf Rechnung" a combined `create-booking-invoice` action in `api/bookla.js` books the slot and sends the invoice atomically.

**Tech Stack:** pdfkit (PDF generation), Resend (email), Jest (unit tests), existing Vercel + Stripe + Bookla stack.

---

## File Map

| Action | File |
|---|---|
| Create | `api/lib/invoice-data.js` — pure functions: tax calc, formatting, data assembly |
| Create | `api/lib/pdf.js` — pdfkit PDF generator |
| Create | `api/lib/email.js` — Resend email sender |
| Create | `api/invoice.js` — Vercel handler for invoice endpoint |
| Create | `tests/invoice-data.test.js` — Jest unit tests |
| Modify | `api/bookla.js` — add `create-booking-invoice` action |
| Modify | `index.html` — address fields, invoice API call, Auf Rechnung flow |
| Modify | `package.json` — add pdfkit, resend, jest |

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install pdfkit resend
npm install --save-dev jest
```

- [ ] **Step 2: Update package.json scripts and jest config**

In `package.json`, add `"test": "jest"` to scripts and a jest config block:

```json
{
  "name": "gameshow-booking",
  "version": "1.0.0",
  "description": "Gameshow Experience Booking Widget + Bookla Integration",
  "scripts": {
    "dev": "vercel dev",
    "deploy": "vercel --prod",
    "test": "jest"
  },
  "jest": {
    "testEnvironment": "node"
  },
  "dependencies": {
    "luxon": "^3.0.0",
    "pdfkit": "^0.15.0",
    "resend": "^4.0.0",
    "stripe": "^14.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0"
  }
}
```

- [ ] **Step 3: Verify install**

```bash
node -e "require('pdfkit'); require('resend'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdfkit, resend, jest"
```

---

## Task 2: Invoice data helpers + tests

**Files:**
- Create: `api/lib/invoice-data.js`
- Create: `tests/invoice-data.test.js`

- [ ] **Step 1: Create `tests/invoice-data.test.js` (failing)**

```javascript
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
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx jest tests/invoice-data.test.js
```

Expected: FAIL with `Cannot find module '../api/lib/invoice-data'`

- [ ] **Step 3: Create `api/lib/invoice-data.js`**

```javascript
function calculateTax(brutto) {
  const b = parseFloat(brutto);
  const netto = Math.round((b / 1.19) * 100) / 100;
  const mwst = Math.round((b - netto) * 100) / 100;
  return { netto, mwst, brutto: b };
}

function formatInvoiceNumber(bookingId) {
  return `RE-${bookingId}`;
}

function formatDate(isoDateOrDate) {
  const d = typeof isoDateOrDate === 'string'
    ? new Date(isoDateOrDate + 'T12:00:00')
    : isoDateOrDate;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function getDueDate(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function buildInvoiceData(params) {
  const {
    bookingId, serviceName, groupSize, amount, paymentMethod,
    date, time, firstName, lastName, email, phone,
    companyName, companyStreet, companyZip, companyCity, ustId,
  } = params;

  return {
    invoiceNumber: formatInvoiceNumber(bookingId),
    invoiceDate: formatDate(new Date()),
    serviceDate: formatDate(date),
    serviceName,
    groupSize: parseInt(groupSize) || 1,
    tax: calculateTax(amount),
    paymentMethod,
    dueDate: getDueDate(14),
    firstName,
    lastName,
    email,
    phone: phone || null,
    isCompany: !!companyName,
    companyName: companyName || null,
    companyStreet: companyStreet || null,
    companyZip: companyZip || null,
    companyCity: companyCity || null,
    ustId: ustId || null,
    bankOwner: process.env.INVOICE_BANK_OWNER || 'HB Kletterwelten GmbH',
    bankIban: process.env.INVOICE_BANK_IBAN || null,
    bankBic: process.env.INVOICE_BANK_BIC || null,
  };
}

module.exports = { calculateTax, formatInvoiceNumber, formatDate, getDueDate, buildInvoiceData };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest tests/invoice-data.test.js
```

Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add api/lib/invoice-data.js tests/invoice-data.test.js
git commit -m "feat: add invoice data helpers with tests"
```

---

## Task 3: PDF generator

**Files:**
- Create: `api/lib/pdf.js`

- [ ] **Step 1: Create `api/lib/pdf.js`**

```javascript
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const COMPANY = {
  name: 'TurmXGames | HB Kletterwelten GmbH',
  address: 'Kurfürstenstr. 58–60 · 50321 Brühl',
  ustId: 'DE328174568',
  hrb: 'HRB 100875 (AG Köln)',
  gf: 'Raimund Bechtloff · Achim Heymann · Marco Gleißner',
  phone: '0 172 585 00 55',
  email: 'games@turmx.de',
};

function fmtEur(amount) {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

function generateInvoicePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const LEFT = 50;
    const RIGHT = doc.page.width - 50;
    const W = RIGHT - LEFT;

    // ── LOGO ──
    const logoPath = path.join(__dirname, '../../logo-cropped.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, LEFT, 45, { height: 36 });
    }

    // ── TITLE top right ──
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#C0392B')
       .text('RECHNUNG', 0, 45, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#444')
       .text(`Rechnungsnummer: ${data.invoiceNumber}`, { align: 'right' })
       .text(`Rechnungsdatum: ${data.invoiceDate}`, { align: 'right' })
       .text(`Leistungsdatum: ${data.serviceDate}`, { align: 'right' });

    // ── COMPANY ADDRESS ──
    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1a1a1a')
       .text(COMPANY.name, LEFT);
    doc.font('Helvetica').fontSize(8.5).fillColor('#555')
       .text(COMPANY.address);

    // ── DIVIDER ──
    const d1y = doc.y + 12;
    doc.moveTo(LEFT, d1y).lineTo(RIGHT, d1y).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
    doc.y = d1y + 16;

    // ── CUSTOMER SECTION ──
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888').text('RECHNUNGSEMPFÄNGER', LEFT);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a');

    if (data.isCompany) {
      doc.text(data.companyName);
      doc.font('Helvetica').fontSize(9).fillColor('#444')
         .text(`${data.firstName} ${data.lastName}`)
         .text(data.companyStreet)
         .text(`${data.companyZip} ${data.companyCity}`);
      if (data.ustId) doc.text(`USt-ID: ${data.ustId}`);
    } else {
      doc.text(`${data.firstName} ${data.lastName}`);
    }

    doc.font('Helvetica').fontSize(9).fillColor('#666').text(data.email);
    if (data.phone) doc.text(data.phone);

    // ── TABLE ──
    const tableY = doc.y + 20;
    const c = { desc: LEFT, qty: LEFT + 255, netto: LEFT + 320, mwst: LEFT + 390, brutto: LEFT + 453 };

    // Header row
    doc.rect(LEFT, tableY, W, 22).fill('#f4f2ee');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text('LEISTUNG', c.desc + 6, tableY + 7);
    doc.text('MENGE', c.qty, tableY + 7);
    doc.text('NETTO', c.netto, tableY + 7);
    doc.text('MWST 19%', c.mwst, tableY + 7);
    doc.text('BRUTTO', c.brutto, tableY + 7);

    // Data row
    const rowY = tableY + 26;
    doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a');
    doc.text(data.serviceName, c.desc + 6, rowY, { width: 240 });
    doc.text(`${data.groupSize} Pers.`, c.qty, rowY);
    doc.text(fmtEur(data.tax.netto), c.netto, rowY);
    doc.text(fmtEur(data.tax.mwst), c.mwst, rowY);
    doc.text(fmtEur(data.tax.brutto), c.brutto, rowY);

    // Totals
    const totY = rowY + 28;
    doc.moveTo(LEFT, totY).lineTo(RIGHT, totY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
    const totLabelX = c.netto - 10;
    const totValW = RIGHT - c.brutto;

    doc.font('Helvetica').fontSize(9).fillColor('#444');
    doc.text('Netto:', totLabelX, totY + 10, { width: 60, align: 'right' });
    doc.text(fmtEur(data.tax.netto), c.brutto, totY + 10, { width: totValW, align: 'right' });
    doc.text('MwSt. 19%:', totLabelX, totY + 24, { width: 60, align: 'right' });
    doc.text(fmtEur(data.tax.mwst), c.brutto, totY + 24, { width: totValW, align: 'right' });

    doc.rect(totLabelX - 10, totY + 38, RIGHT - totLabelX + 10, 22).fill('#f4f2ee');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a');
    doc.text('GESAMT:', totLabelX, totY + 44, { width: 60, align: 'right' });
    doc.text(fmtEur(data.tax.brutto), c.brutto, totY + 44, { width: totValW, align: 'right' });

    // ── ZAHLUNGSART ──
    const payY = totY + 76;
    const payLabels = { cc: 'Kreditkarte', paypal: 'PayPal', sepa: 'SEPA Lastschrift', invoice: 'Kauf auf Rechnung' };
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888').text('ZAHLUNGSART', LEFT, payY);
    doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
       .text(payLabels[data.paymentMethod] || data.paymentMethod, LEFT, payY + 12);

    // ── BANK DETAILS (nur bei "invoice" und wenn IBAN vorhanden) ──
    if (data.paymentMethod === 'invoice' && data.bankIban) {
      const bankY = payY + 36;
      doc.rect(LEFT, bankY, W, 76).fillAndStroke('#fff8f0', '#f5c99a');
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#c0392b')
         .text(`BITTE ÜBERWEISEN SIE DEN BETRAG BIS ZUM ${data.dueDate}`, LEFT + 10, bankY + 10);
      doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
         .text(`Kontoinhaber: ${data.bankOwner}`, LEFT + 10, bankY + 26)
         .text(`IBAN: ${data.bankIban}`, LEFT + 10, bankY + 39)
         .text(`BIC: ${data.bankBic}`, LEFT + 10, bankY + 52)
         .text(`Verwendungszweck: ${data.invoiceNumber}`, LEFT + 10, bankY + 65);
    }

    // ── FOOTER ──
    const footY = doc.page.height - 70;
    doc.moveTo(LEFT, footY).lineTo(RIGHT, footY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#999')
       .text(
         `HB Kletterwelten GmbH · USt-IdNr. ${COMPANY.ustId} · ${COMPANY.hrb} · Geschäftsführer: ${COMPANY.gf}`,
         LEFT, footY + 10, { align: 'center', width: W }
       )
       .text(`fon: ${COMPANY.phone} · ${COMPANY.email}`, LEFT, footY + 22, { align: 'center', width: W });

    doc.end();
  });
}

module.exports = { generateInvoicePDF };
```

- [ ] **Step 2: Manual smoke test — generate a PDF locally**

Create a temporary test script `tests/smoke-pdf.js`:

```javascript
const { generateInvoicePDF } = require('../api/lib/pdf');
const { buildInvoiceData } = require('../api/lib/invoice-data');
const fs = require('fs');

process.env.INVOICE_BANK_IBAN = 'DE12 3456 7890 1234 5678 90';
process.env.INVOICE_BANK_BIC = 'COBADEFFXXX';
process.env.INVOICE_BANK_OWNER = 'HB Kletterwelten GmbH';

const data = buildInvoiceData({
  bookingId: '251295',
  serviceName: 'Firmen-Teamevents',
  groupSize: 4,
  amount: '180.00',
  paymentMethod: 'invoice',
  date: '2026-02-27',
  time: '11:00',
  firstName: 'Jonathan',
  lastName: 'Roxlau',
  email: 'jr@nogency.de',
  phone: '+491735295653',
  companyName: 'Musterfirma GmbH',
  companyStreet: 'Musterstraße 12',
  companyZip: '50321',
  companyCity: 'Brühl',
  ustId: 'DE123456789',
});

generateInvoicePDF(data).then(buf => {
  fs.writeFileSync('tests/smoke-output.pdf', buf);
  console.log('PDF written to tests/smoke-output.pdf');
});
```

Run: `node tests/smoke-pdf.js`

Expected: `tests/smoke-output.pdf` created — open it and verify layout matches the existing PDF style (logo, Rechnung title, Netto/MwSt table, bank details box, footer).

- [ ] **Step 3: Delete smoke test script, commit pdf.js**

```bash
rm tests/smoke-pdf.js tests/smoke-output.pdf
git add api/lib/pdf.js
git commit -m "feat: add pdfkit invoice PDF generator"
```

---

## Task 4: Email sender

**Files:**
- Create: `api/lib/email.js`

- [ ] **Step 1: Create `api/lib/email.js`**

```javascript
const { Resend } = require('resend');

async function sendInvoiceEmail({ to, invoiceNumber, pdfBuffer }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  await resend.emails.send({
    from: process.env.INVOICE_FROM_EMAIL || 'games@turmx.de',
    to,
    subject: `Ihre Rechnung ${invoiceNumber} – TurmX Games`,
    html: `
      <p>Hallo,</p>
      <p>vielen Dank für Ihre Buchung bei TurmX Games!</p>
      <p>Im Anhang finden Sie Ihre Rechnung <strong>${invoiceNumber}</strong>.</p>
      <p>Bei Fragen erreichst du uns jederzeit unter
         <a href="mailto:games@turmx.de">games@turmx.de</a>
         oder 0 172 585 00 55.</p>
      <p>Wir freuen uns auf euren Besuch!</p>
      <p>Viele Grüße<br>Euer TurmX Games Team</p>
    `,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBuffer,
      },
    ],
  });
}

module.exports = { sendInvoiceEmail };
```

- [ ] **Step 2: Commit**

```bash
git add api/lib/email.js
git commit -m "feat: add Resend invoice email sender"
```

---

## Task 5: Invoice API endpoint

**Files:**
- Create: `api/invoice.js`

- [ ] **Step 1: Create `api/invoice.js`**

```javascript
const { buildInvoiceData } = require('./lib/invoice-data');
const { generateInvoicePDF } = require('./lib/pdf');
const { sendInvoiceEmail } = require('./lib/email');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.query;

  try {
    if (action === 'create-invoice') {
      const body = req.body;
      if (!body.bookingId || !body.email || !body.amount) {
        return res.status(400).json({ error: 'bookingId, email, amount required' });
      }

      const invoiceData = buildInvoiceData(body);
      const pdfBuffer = await generateInvoicePDF(invoiceData);
      await sendInvoiceEmail({
        to: body.email,
        invoiceNumber: invoiceData.invoiceNumber,
        pdfBuffer,
      });

      return res.status(200).json({ invoiceId: invoiceData.invoiceNumber });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[Invoice Error]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add api/invoice.js
git commit -m "feat: add /api/invoice endpoint"
```

---

## Task 6: Add `create-booking-invoice` to bookla.js

**Files:**
- Modify: `api/bookla.js`

- [ ] **Step 1: Add the new action after the `create-booking` case in `api/bookla.js`**

After the closing brace of the `case 'create-booking':` block (before `case 'validate-code':`), add:

```javascript
// ─────────────────────────────────────────────
// 4b. Buchung + Rechnung (Auf Rechnung Pfad)
//     Legt Bookla-Buchung an und verschickt
//     sofort die Rechnung mit Bankdaten.
// ─────────────────────────────────────────────
case 'create-booking-invoice': {
  const {
    serviceId, date, time, groupSize, firstName, lastName,
    email, phone, notes, promoCode, serviceName, amount,
    companyName, companyStreet, companyZip, companyCity, ustId,
  } = req.body || {};

  if (!serviceId || !date || !time || !email || !amount) {
    return res.status(400).json({ error: 'serviceId, date, time, email, amount required' });
  }

  const spots = parseInt(groupSize) || 1;
  const berlinDt = DateTime.fromISO(`${date}T${time}:00`, { zone: 'Europe/Berlin' });
  const startTime = berlinDt.toISO();
  const utcTimeKey = berlinDt.toUTC().toISO().substring(0, 16);

  const from = `${date}T00:00:00Z`;
  const to   = `${date}T23:59:59Z`;

  const currentAvailability = await Promise.all(
    RESOURCE_IDS.map(rid =>
      booklaFetch(
        `/client/companies/${companyId}/services/${serviceId}/times`,
        'POST', { from, to, spots, resourceIDs: [rid] }, apiKey
      ).catch(() => null)
    )
  );

  const freeResourceIds = [];
  currentAvailability.forEach((data, i) => {
    if (!data || !data.times) return;
    const rid = RESOURCE_IDS[i];
    const slotArr = data.times[rid] || Object.values(data.times).flat() || [];
    const match = slotArr.find(t => (t.startTime || '').substring(0, 16) === utcTimeKey);
    if (match && match.spotsAvailable === match.totalSpots && match.totalSpots > 0) {
      freeResourceIds.push(rid);
    }
  });

  if (freeResourceIds.length === 0) {
    return res.status(409).json({ error: 'Dieser Slot ist leider nicht mehr verfügbar.' });
  }

  let bookingData = null;
  let lastError = null;
  for (const resourceId of freeResourceIds) {
    try {
      bookingData = await booklaFetch('/client/bookings', 'POST', {
        companyID: companyId, serviceID: serviceId, resourceID: resourceId,
        startTime, spots,
        client: { email, firstName, lastName, ...(phone && { phone }) },
        ...(notes && { metaData: { notes } }),
        ...(promoCode && { code: promoCode }),
      }, apiKey);
      break;
    } catch (e) { lastError = e; }
  }

  if (!bookingData) throw lastError || new Error('Alle Slots belegt');

  // Generate and send invoice
  const { buildInvoiceData } = require('./lib/invoice-data');
  const { generateInvoicePDF } = require('./lib/pdf');
  const { sendInvoiceEmail } = require('./lib/email');

  const invoiceData = buildInvoiceData({
    bookingId: bookingData.id,
    serviceName: serviceName || serviceId,
    groupSize: spots,
    amount,
    paymentMethod: 'invoice',
    date, time,
    firstName, lastName, email, phone,
    companyName, companyStreet, companyZip, companyCity, ustId,
  });

  const pdfBuffer = await generateInvoicePDF(invoiceData);
  await sendInvoiceEmail({ to: email, invoiceNumber: invoiceData.invoiceNumber, pdfBuffer });

  return res.status(201).json({ ...bookingData, invoiceId: invoiceData.invoiceNumber });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/bookla.js
git commit -m "feat: add create-booking-invoice action for Auf Rechnung path"
```

---

## Task 7: Add address fields to frontend (Step 3)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add Straße + PLZ/Ort fields inside `#firmaSection`**

Find this block in `index.html` (around line 692):

```html
          <div class="frow">
            <div class="fg"><label class="flbl">UMSATZSTEUER-ID</label><input type="text" class="finput" id="ustid" placeholder="DE123456789"></div>
            <div class="fg"><label class="flbl">ABTEILUNG</label><input type="text" class="finput" id="dept" placeholder="z.B. Marketing"></div>
          </div>
```

Replace with:

```html
          <div class="frow">
            <div class="fg"><label class="flbl">UMSATZSTEUER-ID</label><input type="text" class="finput" id="ustid" placeholder="DE123456789"></div>
            <div class="fg"><label class="flbl">ABTEILUNG</label><input type="text" class="finput" id="dept" placeholder="z.B. Marketing"></div>
          </div>
          <div class="fg"><label class="flbl">STRASSE &amp; HAUSNUMMER <span style="color:var(--red)">*</span></label><input type="text" class="finput" id="companyStreet" placeholder="Musterstraße 12"></div>
          <div class="frow">
            <div class="fg" style="flex:0 0 140px"><label class="flbl">PLZ <span style="color:var(--red)">*</span></label><input type="text" class="finput" id="companyZip" placeholder="12345"></div>
            <div class="fg"><label class="flbl">ORT <span style="color:var(--red)">*</span></label><input type="text" class="finput" id="companyCity" placeholder="Musterstadt"></div>
          </div>
```

- [ ] **Step 2: Update `step3Next()` to validate address fields for Firmenevent**

Find (around line 1346):

```javascript
function step3Next(){
  const fn=$('fname'),ln=$('lname'),em=$('email');
  let ok=true;
  [fn,ln].forEach(f=>{f.classList.toggle('invalid',!f.value.trim());if(!f.value.trim())ok=false;});
  const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value);
  em.classList.toggle('invalid',!validEmail);
  $('errEmail').classList.toggle('show',!validEmail);
  if(!validEmail)ok=false;
  if(ok)goStep(4);
}
```

Replace with:

```javascript
function step3Next(){
  const fn=$('fname'),ln=$('lname'),em=$('email');
  let ok=true;
  [fn,ln].forEach(f=>{f.classList.toggle('invalid',!f.value.trim());if(!f.value.trim())ok=false;});
  const validEmail=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.value);
  em.classList.toggle('invalid',!validEmail);
  $('errEmail').classList.toggle('show',!validEmail);
  if(!validEmail)ok=false;
  if(S.eventKey==='firma'){
    const cn=$('company'),cs=$('companyStreet'),cz=$('companyZip'),cc=$('companyCity');
    [cn,cs,cz,cc].forEach(f=>{f.classList.toggle('invalid',!f.value.trim());if(!f.value.trim())ok=false;});
  }
  if(ok)goStep(4);
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add company address fields to Firmenevent booking form"
```

---

## Task 8: Call invoice API from frontend after booking

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `INVOICE_API` constant and `callInvoiceAPI` function**

Find (around line 866):

```javascript
const API        = 'https://turmxgames-booking.vercel.app/api/bookla';
```

Replace with:

```javascript
const API         = 'https://turmxgames-booking.vercel.app/api/bookla';
const INVOICE_API = 'https://turmxgames-booking.vercel.app/api/invoice';
```

Then find the `submitBooking` function and add the helper function `callInvoiceAPI` right before it:

```javascript
async function callInvoiceAPI(bookingId){
  try{
    await fetch(INVOICE_API+'?action=create-invoice',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        bookingId,
        serviceName:S.eventName,
        groupSize:S.qty,
        amount:getTotal(),
        paymentMethod:S.payMethod,
        date:S.dateStr,
        time:S.time,
        firstName:$('fname')?.value?.trim(),
        lastName:$('lname')?.value?.trim(),
        email:$('email')?.value?.trim(),
        phone:$('phone')?.value?.trim()||null,
        companyName:$('company')?.value?.trim()||null,
        companyStreet:$('companyStreet')?.value?.trim()||null,
        companyZip:$('companyZip')?.value?.trim()||null,
        companyCity:$('companyCity')?.value?.trim()||null,
        ustId:$('ustid')?.value?.trim()||null,
      }),
    });
  }catch(e){console.error('[Invoice]',e);}
}
```

- [ ] **Step 2: Call `callInvoiceAPI` after successful card/PayPal booking**

In `submitBooking`, find:

```javascript
    const ref=booking.id?'BKL-'+String(booking.id).slice(-6).toUpperCase():'GSH-'+Math.floor(100000+Math.random()*900000);
    showSuccess(ref);
```

Replace with:

```javascript
    const ref=booking.id?'BKL-'+String(booking.id).slice(-6).toUpperCase():'GSH-'+Math.floor(100000+Math.random()*900000);
    if(booking.id)callInvoiceAPI(booking.id);
    showSuccess(ref);
```

- [ ] **Step 3: Add `submitBookingInvoice` for the "Auf Rechnung" path**

Add this new function right after `submitBooking`:

```javascript
async function submitBookingInvoice(){
  const notes=[
    'Event: '+S.eventName,
    'Datum: '+S.dateStr+' '+S.time+' Uhr',
    'Personen: '+S.qty,
    'Gesamtpreis: '+getTotal().toFixed(2)+' EUR',
    'Zahlung: Auf Rechnung',
    $('company')?.value?'Firma: '+$('company').value:null,
    $('wishes')?.value?.trim()||null,
  ].filter(Boolean).join(' | ');
  const payload={
    serviceId:SERVICE_ID,date:S.dateStr,time:S.time,groupSize:S.qty,
    firstName:$('fname')?.value?.trim(),lastName:$('lname')?.value?.trim(),
    email:$('email')?.value?.trim(),phone:$('phone')?.value?.trim()||null,
    serviceName:S.eventName,amount:getTotal(),notes,
    companyName:$('company')?.value?.trim()||null,
    companyStreet:$('companyStreet')?.value?.trim()||null,
    companyZip:$('companyZip')?.value?.trim()||null,
    companyCity:$('companyCity')?.value?.trim()||null,
    ustId:$('ustid')?.value?.trim()||null,
    promoCode:promoState.code||null,
  };
  const r=await fetch(API+'?action=create-booking-invoice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const booking=await r.json();
  if(!r.ok)throw new Error(booking.error||'Buchung fehlgeschlagen');
  const ref=booking.id?'BKL-'+String(booking.id).slice(-6).toUpperCase():'GSH-'+Math.floor(100000+Math.random()*900000);
  showSuccess(ref);
}
```

- [ ] **Step 4: Wire up "Auf Rechnung" in `handlePayment`**

Find:

```javascript
    if(S.payMethod==='invoice'){await delay(600);await submitBooking();return;}
```

Replace with:

```javascript
    if(S.payMethod==='invoice'){await submitBookingInvoice();return;}
```

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: wire invoice API calls in frontend for all payment methods"
```

---

## Task 9: Add environment variables + deploy

- [ ] **Step 1: Add env vars to Vercel project**

In the Vercel dashboard (or via CLI), add:

```
RESEND_API_KEY=re_xxxxxxxxxxxx
INVOICE_FROM_EMAIL=games@turmx.de
INVOICE_BANK_OWNER=HB Kletterwelten GmbH
INVOICE_BANK_IBAN=(add when available)
INVOICE_BANK_BIC=(add when available)
```

Note: `INVOICE_BANK_IBAN` and `INVOICE_BANK_BIC` can be added later — the PDF simply omits the bank details box if IBAN is not set.

- [ ] **Step 2: Deploy**

```bash
npm run deploy
```

Expected: Vercel build succeeds, `api/invoice.js` appears as a new serverless function.

- [ ] **Step 3: End-to-end test with real booking**

Do a test booking with Kreditkarte on the live site and verify:
- Booking confirmation arrives from Bookla as usual
- A second email arrives from `games@turmx.de` with `RE-XXXXXX.pdf` attached
- PDF contains correct Netto/MwSt breakdown, customer name, service, date

---

## Env Variable Reference

| Variable | Required | Value |
|---|---|---|
| `RESEND_API_KEY` | Yes | From resend.com dashboard |
| `INVOICE_FROM_EMAIL` | Yes | `games@turmx.de` |
| `INVOICE_BANK_OWNER` | Yes | `HB Kletterwelten GmbH` |
| `INVOICE_BANK_IBAN` | For "Auf Rechnung" | TBD |
| `INVOICE_BANK_BIC` | For "Auf Rechnung" | TBD |
