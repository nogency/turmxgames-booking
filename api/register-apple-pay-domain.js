/**
 * ONE-TIME setup: Register domains with Stripe for Apple Pay.
 * Call once via: GET /api/register-apple-pay-domain?secret=<your-admin-secret>
 *
 * After running, delete or disable this file.
 */
module.exports = async function handler(req, res) {
  // Simple guard — set ADMIN_SECRET in Vercel env vars
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && req.query.secret !== adminSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  const domains = [
    'buchung.turmxgames.de',
    'turmxgames-booking.vercel.app', // fallback
  ];

  const results = [];
  for (const domain of domains) {
    try {
      const reg = await stripe.applePayDomains.create({ domain_name: domain });
      results.push({ domain, status: 'registered', id: reg.id });
    } catch (e) {
      // "already_exists" is fine
      results.push({ domain, status: e.message });
    }
  }

  return res.status(200).json({ results });
};
