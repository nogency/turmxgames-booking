/**
 * Serves the Apple Pay domain association file required by Stripe.
 *
 * Setup:
 *  1. Stripe Dashboard → Settings → Business Settings → Apple Pay
 *  2. Add your domain (e.g. turmxgames-booking.vercel.app)
 *  3. Download the domain association file Stripe provides
 *  4. Copy the full file content and add it as a Vercel environment variable:
 *       Name:  APPLE_PAY_DOMAIN_ASSOCIATION
 *       Value: <paste the entire file content>
 *  5. Redeploy — Apple Pay will now work on Safari / iOS.
 */
module.exports = (req, res) => {
  const content = process.env.APPLE_PAY_DOMAIN_ASSOCIATION;
  if (!content) {
    return res.status(404).send('Apple Pay domain association not configured. See api/apple-pay-domain.js for setup instructions.');
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(content);
};
