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

    // Data rows (eine pro Position)
    const ROW_H = 26;
    let rowY = tableY + 26;
    const items = data.items && data.items.length ? data.items : [{
      name: data.serviceName,
      qtyLabel: `${data.groupSize} Pers.`,
      tax: data.tax,
    }];

    items.forEach((item, idx) => {
      doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a');
      doc.text(item.name,          c.desc + 6, rowY, { width: 240 });
      doc.text(item.qtyLabel,      c.qty,      rowY);
      doc.text(fmtEur(item.tax.netto),  c.netto,    rowY);
      doc.text(fmtEur(item.tax.mwst),   c.mwst,     rowY);
      doc.text(fmtEur(item.tax.brutto), c.brutto,   rowY);
      // Trennlinie zwischen Zeilen (nicht nach letzter)
      if (idx < items.length - 1) {
        const sepY = rowY + ROW_H - 4;
        doc.moveTo(LEFT, sepY).lineTo(RIGHT, sepY).strokeColor('#eeebe5').lineWidth(0.5).stroke();
      }
      rowY += ROW_H;
    });

    // Totals
    const totY = rowY + 4;
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
    const payY = totY + 58;
    const isInvoice = data.paymentMethod === 'invoice';
    const payLabels = { cc: 'Kreditkarte', paypal: 'PayPal', sepa: 'SEPA-Lastschrift', invoice: 'Kauf auf Rechnung' };
    const payLabel = payLabels[data.paymentMethod] || data.paymentMethod;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888').text('ZAHLUNGSART', LEFT, payY);

    if (!isInvoice) {
      // Paid — green checkmark box
      const paidBoxY = payY + 10;
      doc.rect(LEFT, paidBoxY, W, 28).fillAndStroke('#f0faf4', '#a8dab5');
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a7340')
         .text(`✓  Bereits via ${payLabel} bezahlt`, LEFT + 10, paidBoxY + 9);
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
         .text(payLabel, LEFT, payY + 12);

      // ── BANK DETAILS ──
      if (data.bankIban) {
        const bankY = payY + 34;
        doc.rect(LEFT, bankY, W, 80).fillAndStroke('#fff8f0', '#f5c99a');
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#c0392b')
           .text(`BITTE ÜBERWEISEN SIE DEN BETRAG BIS ZUM ${data.dueDate}`, LEFT + 10, bankY + 10);
        doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
           .text(`Kontoinhaber: ${data.bankOwner}`, LEFT + 10, bankY + 26)
           .text(`IBAN:  ${data.bankIban}`, LEFT + 10, bankY + 40)
           .text(`BIC:   ${data.bankBic || ''}`, LEFT + 10, bankY + 54)
           .text(`Verwendungszweck: ${data.invoiceNumber}`, LEFT + 10, bankY + 68);
      }
    }

    // ── FOOTER ──
    const footY = doc.page.height - 95;
    doc.moveTo(LEFT, footY).lineTo(RIGHT, footY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#999')
       .text(
         `HB Kletterwelten GmbH · USt-IdNr. ${COMPANY.ustId} · ${COMPANY.hrb} · Geschäftsführer: ${COMPANY.gf}`,
         LEFT, footY + 10, { align: 'center', width: W }
       )
       .text(`fon: ${COMPANY.phone} · ${COMPANY.email}`, LEFT, footY + 30, { align: 'center', width: W });

    doc.end();
  });
}

module.exports = { generateInvoicePDF };
