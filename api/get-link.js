const { Redis } = require('@upstash/redis');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.query;
  if (!id || !/^[A-Z0-9]{4,10}$/.test(id)) {
    return res.status(400).json({ error: 'Ungültige ID' });
  }

  const redis = new Redis({
    url:   process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const raw = await redis.get(`bl:${id}`);
  if (!raw) {
    return res.status(404).json({ error: 'Link nicht gefunden oder abgelaufen' });
  }

  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return res.status(200).json(data);
};
