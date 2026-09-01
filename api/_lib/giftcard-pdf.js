const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const COMPANY = {
  name: 'TurmXGames | HB Kletterwelten GmbH',
  address: 'Kurfürstenstr. 58–60 · 50321 Brühl',
  ustId: 'DE328174568',
  hrb: 'HRB 100875 (AG Köln)',
  phone: '0 172 585 00 55',
  email: 'games@turmx.de',
};

function fmtEur(amount) {
  return amount.toFixed(2).replace('.', ',') + ' €';
}

/**
 * Erzeugt das Gutschein-PDF (A4 quer) als Buffer.
 * data: { code, amountEur, validUntil (dd.mm.yyyy), buyerName }
 */
function generateGiftcardPDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;   // 841.89
    const PH = doc.page.height;  // 595.28

    // ── Hintergrund ──
    doc.rect(0, 0, PW, PH).fill('#faf8f5');
    // Roter Rahmen
    doc.rect(24, 24, PW - 48, PH - 48).lineWidth(3).stroke('#C0392B');
    doc.rect(32, 32, PW - 64, PH - 64).lineWidth(0.75).stroke('#e0b7b0');

    // ── Logo ──
    const logoPath = path.join(__dirname, '../../logo-cropped.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, PW / 2 - 60, 64, { width: 120 });
    }

    // ── Titel ──
    doc.font('Helvetica-Bold').fontSize(46).fillColor('#C0392B')
       .text('GUTSCHEIN', 0, 150, { align: 'center', width: PW, characterSpacing: 8 });
    doc.font('Helvetica').fontSize(13).fillColor('#666')
       .text('für ein unvergessliches TurmX Games Erlebnis', 0, 208, { align: 'center', width: PW });

    // ── Betrag ──
    doc.font('Helvetica-Bold').fontSize(64).fillColor('#1a1a1a')
       .text(fmtEur(data.amountEur), 0, 250, { align: 'center', width: PW });

    // ── Code-Box ──
    const boxW = 340, boxH = 64;
    const boxX = (PW - boxW) / 2, boxY = 350;
    doc.rect(boxX, boxY, boxW, boxH).fillAndStroke('#ffffff', '#C0392B');
    doc.font('Helvetica').fontSize(9).fillColor('#888')
       .text('DEIN GUTSCHEIN-CODE', boxX, boxY + 10, { align: 'center', width: boxW, characterSpacing: 2 });
    doc.font('Courier-Bold').fontSize(24).fillColor('#C0392B')
       .text(data.code, boxX, boxY + 26, { align: 'center', width: boxW, characterSpacing: 3 });

    // ── Einlöse-Hinweis ──
    doc.font('Helvetica').fontSize(11).fillColor('#444')
       .text('Einlösbar auf booking.turmxgames.de — gib den Code einfach im Feld „Rabatt-Code" ein.',
             0, boxY + boxH + 22, { align: 'center', width: PW });
    doc.font('Helvetica').fontSize(9.5).fillColor('#888')
       .text(`Gültig bis ${data.validUntil} · Einmalig einlösbar · Keine Barauszahlung`,
             0, boxY + boxH + 42, { align: 'center', width: PW });

    // ── Footer ──
    const footY = PH - 72;
    doc.moveTo(80, footY).lineTo(PW - 80, footY).strokeColor('#e0ddd7').lineWidth(0.75).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor('#999')
       .text(`${COMPANY.name} · ${COMPANY.address} · USt-IdNr. ${COMPANY.ustId} · ${COMPANY.hrb}`,
             0, footY + 12, { align: 'center', width: PW })
       .text(`fon: ${COMPANY.phone} · ${COMPANY.email}`,
             0, footY + 26, { align: 'center', width: PW });

    doc.end();
  });
}

module.exports = { generateGiftcardPDF };
