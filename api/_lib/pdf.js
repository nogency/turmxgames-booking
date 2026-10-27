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
    // Bewusst KEINE Rechnung: Auftragsbestätigung ohne formalen USt-Ausweis.
    // Die Rechnung folgt nach dem Event via InvoiceNinja (§14c-Risiko vermeiden).
    doc.font('Helvetica-Bold').fontSize(19).fillColor('#C0392B')
       .text('AUFTRAGSBESTÄTIGUNG', 0, 45, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#444')
       .text(`Bestätigungsnummer: ${data.invoiceNumber}`, { align: 'right' })
       .text(`Datum: ${data.invoiceDate}`, { align: 'right' })
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
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888').text('AUFTRAGGEBER', LEFT);
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
    // Nur Bruttobeträge — KEIN formaler USt-Ausweis (Netto/MwSt-Spalten),
    // damit das Dokument nicht als Rechnung i.S.d. §14 UStG gewertet werden kann.
    const tableY = doc.y + 20;
    const c = { desc: LEFT, qty: LEFT + 300, brutto: LEFT + 400 };
    const bruttoW = RIGHT - c.brutto;

    // Header row
    doc.rect(LEFT, tableY, W, 22).fill('#f4f2ee');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#555');
    doc.text('LEISTUNG', c.desc + 6, tableY + 7);
    doc.text('MENGE', c.qty, tableY + 7);
    doc.text('BETRAG', c.brutto, tableY + 7, { width: bruttoW - 6, align: 'right' });

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
      doc.text(item.name,          c.desc + 6, rowY, { width: 285 });
      doc.text(item.qtyLabel,      c.qty,      rowY);
      doc.text(fmtEur(item.tax.brutto), c.brutto, rowY, { width: bruttoW - 6, align: 'right' });
      // Trennlinie zwischen Zeilen (nicht nach letzter)
      if (idx < items.length - 1) {
        const sepY = rowY + ROW_H - 4;
        doc.moveTo(LEFT, sepY).lineTo(RIGHT, sepY).strokeColor('#eeebe5').lineWidth(0.5).stroke();
      }
      rowY += ROW_H;
    });

    // Totals — nur Gesamtbetrag inkl. MwSt., keine Aufschlüsselung
    const totY = rowY + 4;
    doc.moveTo(LEFT, totY).lineTo(RIGHT, totY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();

    doc.rect(LEFT, totY + 10, W, 22).fill('#f4f2ee');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a1a1a');
    doc.text('GESAMT (inkl. 19 % MwSt.):', LEFT + 6, totY + 16, { width: W - bruttoW - 12, align: 'right' });
    doc.text(fmtEur(data.tax.brutto), c.brutto, totY + 16, { width: bruttoW - 6, align: 'right' });

    // ── HINWEIS: keine Rechnung ──
    const hintY = totY + 42;
    doc.rect(LEFT, hintY, W, 30).fillAndStroke('#eef4fb', '#a9c7e8');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1c4e89')
       .text('Dies ist keine Rechnung. Deine Rechnung erhältst du nach deinem Event per E-Mail.',
             LEFT + 10, hintY + 10, { width: W - 20 });

    // ── ZAHLUNGSART ──
    const payY = hintY + 44;
    const isInvoice = data.paymentMethod === 'invoice';
    const payLabels = { cc: 'Kreditkarte', paypal: 'PayPal', sepa: 'SEPA-Lastschrift', invoice: 'Kauf auf Rechnung', voucher: 'Gutschein' };
    const payLabel = payLabels[data.paymentMethod] || data.paymentMethod;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888').text('ZAHLUNGSART', LEFT, payY);

    let afterPayY;
    if (!isInvoice) {
      // Paid — green checkmark box
      const paidBoxY = payY + 10;
      doc.rect(LEFT, paidBoxY, W, 28).fillAndStroke('#f0faf4', '#a8dab5');
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#1a7340')
         .text(`✓  Bereits via ${payLabel} bezahlt`, LEFT + 10, paidBoxY + 9);
      afterPayY = paidBoxY + 28;
    } else {
      doc.font('Helvetica').fontSize(9).fillColor('#1a1a1a')
         .text(payLabel, LEFT, payY + 12);
      afterPayY = payY + 26;

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
        afterPayY = bankY + 80;
      }
    }

    // ── FOOTER (auf jeder Seite) ──
    const footY = doc.page.height - 95;
    const drawFooter = () => {
      doc.moveTo(LEFT, footY).lineTo(RIGHT, footY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#999')
         .text(
           `HB Kletterwelten GmbH · USt-IdNr. ${COMPANY.ustId} · ${COMPANY.hrb} · Geschäftsführer: ${COMPANY.gf}`,
           LEFT, footY + 10, { align: 'center', width: W }
         )
         .text(`fon: ${COMPANY.phone} · ${COMPANY.email}`, LEFT, footY + 30, { align: 'center', width: W });
    };

    // ── STORNIERUNG & UMBUCHUNG (AGB §5, Daten ab Buchungstag gerechnet) ──
    // Passt der Kasten nicht mehr über die Fußzeile, kommt er auf eine zweite Seite.
    const storno = data.storno || { lines: [], notes: [] };
    if (storno.lines.length || storno.notes.length) {
      const PAD = 10, TW = W - 2 * PAD;
      const lines = storno.lines.map(l => `•  ${l}`);
      const notes = storno.notes.concat('Es gelten unsere AGB.');
      doc.font('Helvetica').fontSize(8.5);
      const hOf = arr => arr.reduce((h, t) => h + doc.heightOfString(t, { width: TW }) + 2, 0);
      const boxH = PAD + 14 + hOf(lines) + 4 + hOf(notes) + PAD - 2;
      let boxY = afterPayY + 16;
      if (boxY + boxH > footY - 12) { drawFooter(); doc.addPage(); boxY = 50; }

      doc.rect(LEFT, boxY, W, boxH).fillAndStroke('#f7f6f3', '#e0ddd7');
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#888')
         .text('STORNIERUNG & UMBUCHUNG', LEFT + PAD, boxY + PAD);
      let ly = boxY + PAD + 14;
      doc.font('Helvetica').fontSize(8.5).fillColor('#1a1a1a');
      lines.forEach(t => { doc.text(t, LEFT + PAD, ly, { width: TW }); ly = doc.y + 2; });
      ly += 4;
      doc.fillColor('#555');
      notes.forEach(t => { doc.text(t, LEFT + PAD, ly, { width: TW }); ly = doc.y + 2; });
    }

    drawFooter();
    doc.end();
  });
}

module.exports = { generateInvoicePDF };
