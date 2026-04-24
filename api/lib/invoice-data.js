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
    drinksFlat, drinksPrice, insurance, baseAmount,
  } = params;

  const spots = parseInt(groupSize) || 1;

  // ── Positionen aufbauen ──
  const items = [];

  // 1. Haupt-Event
  const eventAmount = parseFloat(baseAmount || amount);
  items.push({
    name: serviceName,
    qtyLabel: `${spots} Pers.`,
    tax: calculateTax(eventAmount),
  });

  // 2. Getränkeflat (drinksPrice × Personen)
  if (drinksFlat) {
    const dprice = parseFloat(drinksPrice) || 12.90;
    const drinkTotal = Math.round(dprice * spots * 100) / 100;
    items.push({
      name: 'Getränkeflat',
      qtyLabel: `${spots} Pers.`,
      tax: calculateTax(drinkTotal),
    });
  }

  // 3. Flex-Versicherung (14,90 € pauschal)
  if (insurance) {
    items.push({
      name: 'Flex-Versicherung',
      qtyLabel: '1×',
      tax: calculateTax(14.90),
    });
  }

  // ── Gesamtsteuer (Summe aller Positionen) ──
  const tax = {
    brutto: Math.round(items.reduce((s, i) => s + i.tax.brutto, 0) * 100) / 100,
    netto:  Math.round(items.reduce((s, i) => s + i.tax.netto,  0) * 100) / 100,
    mwst:   Math.round(items.reduce((s, i) => s + i.tax.mwst,   0) * 100) / 100,
  };

  return {
    invoiceNumber: formatInvoiceNumber(bookingId),
    invoiceDate:   formatDate(new Date()),
    serviceDate:   formatDate(date),
    serviceName,
    groupSize: spots,
    items,
    tax,
    paymentMethod,
    dueDate:   getDueDate(14),
    firstName,
    lastName,
    email,
    phone:       phone || null,
    isCompany:   !!companyName,
    companyName:   companyName   || null,
    companyStreet: companyStreet || null,
    companyZip:    companyZip    || null,
    companyCity:   companyCity   || null,
    ustId:         ustId         || null,
    bankOwner: process.env.INVOICE_BANK_OWNER || 'HB Kletterwelten GmbH',
    bankIban:  process.env.INVOICE_BANK_IBAN  || 'DE13382501100001720465',
    bankBic:   process.env.INVOICE_BANK_BIC   || 'WELADED1EUS',
  };
}

module.exports = { calculateTax, formatInvoiceNumber, formatDate, getDueDate, buildInvoiceData };
