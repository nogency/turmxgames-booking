/**
 * Serves the Apple Pay domain association file.
 *
 * Priority:
 *  1. APPLE_PAY_DOMAIN_ASSOCIATION env var (custom content from Stripe Dashboard)
 *  2. Fetches Stripe's standard file on-the-fly as fallback
 *
 * The file must be accessible at:
 *   /.well-known/apple-developer-merchantid-domain-association
 * (routed here via vercel.json rewrite)
 */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=86400');

  // 1. Use custom env var if provided
  const content = process.env.APPLE_PAY_DOMAIN_ASSOCIATION;
  if (content) {
    return res.send(content);
  }

  // 2. Proxy Stripe's standard domain association file
  try {
    const upstream = await fetch(
      'https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association'
    );
    if (!upstream.ok) throw new Error(`Stripe returned ${upstream.status}`);
    const text = await upstream.text();
    return res.send(text);
  } catch (e) {
    console.error('[ApplePay Domain] Failed to fetch Stripe file:', e.message);
    return res.status(502).send('Could not retrieve Apple Pay domain association file.');
  }
};
