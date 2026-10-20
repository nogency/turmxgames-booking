/**
 * Serverseitige Preis- und Zahlungsprüfung.
 *
 * STUFE 1 – NUR BEOBACHTEN: Der Server rechnet den erwarteten Betrag mit shared/pricing.js
 * (derselbe Code wie im Browser) und vergleicht ihn mit dem, was angelegt bzw. bezahlt wurde.
 * Das Ergebnis wird protokolliert (Vercel-Log + Redis). Es wird NICHTS blockiert oder verändert,
 * und keine Funktion hier wirft einen Fehler nach außen.
 *
 * Reine Funktionen (normalizeOrder, orderHash, expectedQuote, classify*) sind ohne Netzwerk
 * testbar (tests/paycheck.test.js). Stripe, PayPal, Bookla und Redis kommen als `deps` von außen.
 */
const crypto = require('crypto');
const P = require('../../shared/pricing');

const LOG_KEY = 'paycheck:log';
const STATS_KEY = 'paycheck:stats';
const LOG_MAX = 2000;
const USED_TTL = 400 * 86400;   // Zahlung gilt ~13 Monate als "verwendet"

const toCents = eur => Math.round(Number(eur) * 100);
const dowOf = date => { const [y, m, d] = String(date).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r({ timeout: true }), ms))]);

/** Bestellung aus dem Browser prüfen und vereinheitlichen. → { order } oder { error } */
function normalizeOrder(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'keine Bestellung mitgeschickt' };
  const event = String(raw.event || '');
  if (!P.EVENTS[event]) return { error: 'unbekanntes Event' };
  const date = String(raw.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'Datum ungültig' };
  const time = String(raw.time || '');
  if (!/^\d{2}:\d{2}$/.test(time)) return { error: 'Uhrzeit ungültig' };
  const qty = parseInt(raw.qty, 10);
  if (!(qty >= P.MIN_QTY && qty <= P.MAX_QTY)) return { error: 'Personenzahl ungültig' };
  const ex = raw.extras || {};
  const extras = { drinks: !!ex.drinks, insurance: !!ex.insurance, freefall: !!ex.freefall && event === 'jga' };
  const promoCode = raw.promoCode ? String(raw.promoCode).trim().toUpperCase().slice(0, 40) : null;
  const adminLinkId = raw.adminLinkId ? String(raw.adminLinkId).trim().slice(0, 12) : null;
  return { order: { event, date, time, qty, extras, promoCode, adminLinkId } };
}

/** Fingerabdruck einer Bestellung: bindet eine Zahlung an genau diese Buchung. */
function orderHash(o) {
  const canon = [o.event, o.date, o.time, o.qty, o.extras.drinks ? 1 : 0, o.extras.insurance ? 1 : 0, o.extras.freefall ? 1 : 0, o.promoCode || '', o.adminLinkId || ''].join('|');
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 24);
}

/**
 * Erwarteter Preis. Mit Admin-Link gelten Event, Datum, Personen, Extras und Preise aus dem
 * gespeicherten Link – genau wie im Frontend (v2/js/main.js loadAdminLink), ohne Code.
 */
function expectedQuote(order, { promoDef = null, link = null } = {}) {
  if (link) {
    const date = link.date || (order && order.date);
    return P.quote({
      event: P.EVENTS[link.eventKey] ? link.eventKey : 'jga',
      dow: date ? dowOf(date) : null,
      qty: parseInt(link.groupSize, 10) || 4,
      extras: { drinks: !!link.drinksFlat, insurance: !!link.insurance, freefall: !!link.freefall },
      promoDef: null,
      override: { pp: parseFloat(link.pricePerPerson) || 35, base: parseFloat(link.basePrice) || 40 },
    });
  }
  return P.quote({ event: order.event, dow: dowOf(order.date), qty: order.qty, extras: order.extras, promoDef });
}

/** Betrag aus dem Browser gegen den erwarteten Betrag. */
function classifyAmount(clientEur, expectedCents) {
  const actualCents = toCents(clientEur);
  if (!Number.isFinite(actualCents)) return { result: 'abweichung', issues: ['kein Betrag'], actualCents: null };
  return actualCents === expectedCents
    ? { result: 'ok', issues: [], actualCents }
    : { result: 'abweichung', issues: [`Betrag ${actualCents} statt ${expectedCents}`], actualCents };
}

/** Stripe-Zahlung (PaymentIntent) gegen Erwartung. */
function classifyStripe(pi, expectedCents, hash) {
  if (!pi) return { result: 'keine-zahlung', issues: ['Stripe-Zahlung nicht gefunden'], actualCents: null };
  const issues = [];
  if (pi.currency !== 'eur') issues.push('Währung ' + pi.currency);
  if (expectedCents != null && pi.amount !== expectedCents) issues.push(`Betrag ${pi.amount} statt ${expectedCents}`);
  if (!['succeeded', 'processing', 'requires_capture'].includes(pi.status)) issues.push('Status ' + pi.status);
  const md = pi.metadata || {};
  if (md.kind && md.kind !== 'booking') issues.push('Zahlung für ' + md.kind);
  if (hash && md.orderHash && md.orderHash !== hash) issues.push('Zahlung gehört zu anderer Bestellung');
  return { result: issues.length ? 'abweichung' : 'ok', issues, actualCents: pi.amount, status: pi.status };
}

/** PayPal-Autorisierung gegen Erwartung. */
function classifyPaypal(auth, expectedCents) {
  if (!auth) return { result: 'keine-zahlung', issues: ['PayPal-Freigabe nicht gefunden'], actualCents: null };
  const issues = [];
  const amt = auth.amount || {};
  const actualCents = toCents(amt.value);
  if (amt.currency_code !== 'EUR') issues.push('Währung ' + amt.currency_code);
  if (expectedCents != null && actualCents !== expectedCents) issues.push(`Betrag ${actualCents} statt ${expectedCents}`);
  if (!['CREATED', 'PENDING', 'CAPTURED'].includes(auth.status)) issues.push('Status ' + auth.status);
  return { result: issues.length ? 'abweichung' : 'ok', issues, actualCents, status: auth.status };
}

/** Kurzfassung der Bestellung fürs Protokoll (keine persönlichen Daten). */
const summarize = o => ({
  event: o.event, date: o.date, time: o.time, qty: o.qty,
  extras: ['drinks', 'insurance', 'freefall'].filter(k => o.extras[k]).join(',') || '-',
  promo: o.promoCode || null, link: o.adminLinkId || null,
});

/**
 * Eine Prüfung durchführen. Wirft nie.
 * stage: 'zahlung-anlegen' | 'buchung' | 'rechnung' | 'admin-link'
 * deps:  { getPromoDef(code), getLink(id), getStripePI(id), getPaypalAuth(id), redis }
 */
async function evaluate({ stage, rawOrder, clientAmount = null, paymentIntentId = null, paypalAuthId = null, link = null, deps = {} }) {
  const e = {
    ts: new Date().toISOString(), stage,
    method: paymentIntentId ? 'stripe' : paypalAuthId ? 'paypal' : clientAmount != null ? 'betrag' : 'keine',
    ref: paymentIntentId || paypalAuthId || null,
  };
  try {
    const n = normalizeOrder(rawOrder);
    const o = n.order || null;
    if (o) { e.order = summarize(o); e.hash = orderHash(o); }
    let theLink = link;
    if (!theLink && o && o.adminLinkId && deps.getLink) theLink = await deps.getLink(o.adminLinkId);
    if (!o && !theLink) {
      e.result = 'ohne-bestellung'; e.issues = [n.error];
      e.actualCents = clientAmount != null ? toCents(clientAmount) : null;
      return e;
    }
    let promoDef = null;
    if (!theLink && o.promoCode && deps.getPromoDef) {
      promoDef = await deps.getPromoDef(o.promoCode);
      if (!promoDef) e.notes = ['Code-Definition nicht gefunden'];
    }
    e.expectedCents = toCents(expectedQuote(o, { promoDef, link: theLink }).total);
    let c;
    if (paymentIntentId) c = classifyStripe(deps.getStripePI ? await deps.getStripePI(paymentIntentId) : null, e.expectedCents, e.hash);
    else if (paypalAuthId) c = classifyPaypal(deps.getPaypalAuth ? await deps.getPaypalAuth(paypalAuthId) : null, e.expectedCents);
    else if (clientAmount != null) c = classifyAmount(clientAmount, e.expectedCents);
    else c = { result: 'keine-zahlung', issues: ['weder Zahlung noch Betrag'], actualCents: null };
    Object.assign(e, c);
  } catch (err) {
    e.result = 'fehler'; e.issues = [String((err && err.message) || err)];
  }
  return e;
}

/** Ins Vercel-Log und nach Redis (begrenzte Liste + Zähler). Wirft nie. */
async function record(entry, redis) {
  const line = '[PAYCHECK] ' + JSON.stringify(entry);
  if (entry.result === 'ok') console.log(line); else console.warn(line);
  if (!redis) return;
  try {
    await Promise.all([
      redis.lpush(LOG_KEY, JSON.stringify(entry)).then(() => redis.ltrim(LOG_KEY, 0, LOG_MAX - 1)),
      redis.hincrby(STATS_KEY, `${entry.stage}:${entry.result}`, 1),
    ]);
  } catch (err) {
    console.error('[PAYCHECK] Protokoll in Redis fehlgeschlagen:', err && err.message);
  }
}

/**
 * Laufende Prüfung abschließen: mit Zeitlimit abwarten, mehrfach verwendete Zahlungen erkennen,
 * protokollieren. Wirft nie und wartet höchstens timeoutMs.
 */
async function finish(promise, { stage, bookingId = null, deps = {}, timeoutMs = 1500 } = {}) {
  try {
    const e = await withTimeout(promise, timeoutMs);
    if (!e || e.timeout) {
      await record({ ts: new Date().toISOString(), stage, result: 'zeitlimit', bookingId }, deps.redis);
      return;
    }
    if (bookingId) e.bookingId = bookingId;
    if (e.ref && bookingId && deps.redis) {
      const key = `paycheck:used:${e.ref}`;
      const fresh = await deps.redis.set(key, String(bookingId), { nx: true, ex: USED_TTL });
      if (!fresh) {
        const prev = await deps.redis.get(key);
        if (prev && String(prev) !== String(bookingId)) {
          e.result = 'abweichung';
          e.issues = (e.issues || []).concat('Zahlung schon für Buchung ' + prev + ' verwendet');
        }
      }
    }
    await record(e, deps.redis);
  } catch (err) {
    console.error('[PAYCHECK] Abschluss fehlgeschlagen:', err && err.message);
  }
}

module.exports = {
  normalizeOrder, orderHash, expectedQuote, classifyAmount, classifyStripe, classifyPaypal,
  evaluate, record, finish, withTimeout, toCents, LOG_KEY, STATS_KEY,
};
