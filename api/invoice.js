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
