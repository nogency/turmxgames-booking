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
  // STRIPE_PK is required — without it Stripe can't initialise at all
  if (!process.env.STRIPE_PK) {
    return res.status(500).json({ error: 'Missing STRIPE_PK env var' });
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    stripePk:      process.env.STRIPE_PK,
    paypalClientId: process.env.PAYPAL_CLIENT_ID || null,  // optional — PayPal tab hidden if missing
  });
};
