/**
 * Public config endpoint — returns non-secret keys safe for the frontend.
 *
 * Set these in Vercel → Settings → Environment Variables:
 *
 *   STRIPE_PK           pk_live_...        (Stripe publishable key)
 *   PAYPAL_CLIENT_ID    A...               (PayPal live Client ID)
 *   STRIPE_SECRET_KEY   sk_live_...        (Stripe secret key — already used in bookla.js)
 */
module.exports = (req, res) => {
  if (!process.env.STRIPE_PK || !process.env.PAYPAL_CLIENT_ID) {
    return res.status(500).json({ error: 'Missing env vars: STRIPE_PK and/or PAYPAL_CLIENT_ID' });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    stripePk: process.env.STRIPE_PK,
    paypalClientId: process.env.PAYPAL_CLIENT_ID,
  });
};
