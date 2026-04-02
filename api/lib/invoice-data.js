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
