const { Redis } = require('@upstash/redis');

function generateId(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusable chars
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const secret = process.env.ADMIN_SECRET;
  const auth   = req.headers['authorization'] || '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    eventKey, eventName, date, time, groupSize,
    pricePerPerson, basePrice,
    drinksFlat, insurance, freefall,
    promoCode,
    firstName, lastName, email, phone,
    companyName, companyStreet, companyZip, companyCity, ustId,
    expiresInDays = 14,
  } = req.body || {};

  if (!eventKey || !date || !time || !groupSize || !email) {
    return res.status(400).json({ error: 'eventKey, date, time, groupSize, email erforderlich' });
  }

  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  // Generate unique ID
  let id, attempts = 0;
  do {
    id = generateId();
    attempts++;
  } while (attempts < 5 && await redis.exists(`bl:${id}`));

  const payload = {
    eventKey, eventName, date, time,
    groupSize:      parseInt(groupSize) || 4,
    pricePerPerson: parseFloat(pricePerPerson) || 35,
    basePrice:      parseFloat(basePrice) || 40,
    drinksFlat:     !!drinksFlat,
    insurance:      !!insurance,
    freefall:       !!freefall,
    promoCode:      promoCode || null,
    firstName:      firstName || '',
    lastName:       lastName  || '',
    email:          email     || '',
    phone:          phone     || '',
    companyName:    companyName    || null,
    companyStreet:  companyStreet  || null,
    companyZip:     companyZip     || null,
    companyCity:    companyCity    || null,
    ustId:          ustId          || null,
    createdAt:      new Date().toISOString(),
  };

  const ttlSeconds = Math.min(Math.max(parseInt(expiresInDays) || 14, 1), 30) * 86400;
  await redis.set(`bl:${id}`, JSON.stringify(payload), { ex: ttlSeconds });

  return res.status(200).json({ id, url: `https://booking.turmxgames.de/?b=${id}` });
};
