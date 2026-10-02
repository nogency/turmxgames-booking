/**
 * TurmX Games – Preislogik (einzige Quelle)
 *
 * Läuft im Browser (window.TXPricing) UND auf dem Server (require('../shared/pricing')).
 * Bookla kennt unsere Paketpreise nicht (alle Eventarten teilen einen Service), deshalb
 * liegt die Preislogik hier. Rechenweg identisch zur bisherigen index.html
 * (Stand Commit fc6b3f1: Tagespreis je Eventart, Rabatt live aus Code-Definition).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TXPricing = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VAT_RATE = 0.19;
  const PRICES = { weekday: 28, friday: 30, weekend: 35 };
  const KINDER_PRICES = { weekday: 24, weekend: 30 };
  const SOCIAL_PRICE = 25;
  const DRINKS = { default: 12.9, kinder: 7.9 };
  const INSURANCE = 14.9;
  const FREEFALL = 30;
  const MIN_QTY = 4;
  const MAX_QTY = 32;

  // name = Bezeichnung in Bookla-Notizen, Auftragsbestätigung und Tracking (unverändert zu v1)
  const EVENTS = {
    jga:     { name: 'JGA',                base: 40, minutes: 150 },
    firma:   { name: 'Firmen & Teams',     base: 40, minutes: 150 },
    friends: { name: 'Freunde & Familie',  base: 40, minutes: 150 },
    kinder:  { name: 'Kindergeburtstag',   base: 60, minutes: 120 },
    schule:  { name: 'Schulausflug',       base: 0,  minutes: 120 },
    verein:  { name: 'Verein',             base: 0,  minutes: 120 },
  };

  const round2 = n => Math.round(n * 100) / 100;
  const isSocial = ev => ev === 'schule' || ev === 'verein';

  /** Preis pro Person je Eventart + Wochentag (dow 0=So … 6=Sa; null = noch kein Datum → Wochentagspreis). */
  function ppForDay(ev, dow) {
    if (isSocial(ev)) return SOCIAL_PRICE;
    const weekend = dow === 6 || dow === 0;
    if (ev === 'kinder') return weekend ? KINDER_PRICES.weekend : KINDER_PRICES.weekday;
    if (ev === 'firma') return PRICES.weekend;   // Firmen & Teams: immer 35 €, kein Weekday-Rabatt
    return dow === 5 ? PRICES.friday : (weekend ? PRICES.weekend : PRICES.weekday);
  }

  /** Niedrigster Preis pro Person (für "ab …"-Anzeigen). */
  function minPP(ev) { return ppForDay(ev, 1); }

  const drinksPrice = ev => (ev === 'kinder' ? DRINKS.kinder : DRINKS.default);

  /**
   * Rabatt in EUR aus der Bookla-Code-Definition, angewendet NUR auf Grundgebühr + Personenpreis.
   * def = { discountType: 'percent'|'amount', discountValue, maxDiscountCents }
   */
  function promoDiscount(def, baseOnly) {
    if (!def) return 0;
    let disc = 0;
    if (def.discountType === 'percent' && def.discountValue > 0) {
      disc = baseOnly * def.discountValue / 100;
      if (def.maxDiscountCents > 0) disc = Math.min(disc, def.maxDiscountCents / 100);
    } else if (def.discountType === 'amount' && def.discountValue > 0) {
      disc = def.discountValue / 100;
    }
    return round2(Math.min(disc, baseOnly));
  }

  /**
   * Komplettes Angebot.
   * opts = { event, dow, qty, extras: {drinks, insurance, freefall}, promoDef, override: {base, pp} }
   * override: vom Admin im Buchungslink festgelegte Preise (Individualangebot)
   */
  function quote(opts) {
    const ev = EVENTS[opts.event];
    if (!ev) return null;
    const qty = opts.qty;
    const extras = opts.extras || {};
    const base = opts.override && opts.override.base != null ? opts.override.base : ev.base;
    const pp = opts.override && opts.override.pp != null ? opts.override.pp : ppForDay(opts.event, opts.dow);
    const baseOnly = base + pp * qty;
    const discount = promoDiscount(opts.promoDef, baseOnly);

    const lines = [];
    if (base) lines.push({ key: 'base', amount: base });
    lines.push({ key: 'persons', amount: pp * qty, qty, unit: pp });
    const dp = drinksPrice(opts.event);
    const drinksTotal = extras.drinks ? round2(dp * qty) : 0;
    if (extras.drinks) lines.push({ key: 'drinks', amount: drinksTotal, qty, unit: dp });
    if (extras.insurance) lines.push({ key: 'insurance', amount: INSURANCE });
    const ff = extras.freefall && opts.event === 'jga';
    if (ff) lines.push({ key: 'freefall', amount: FREEFALL });

    // Gleicher Rechenweg wie v1 getTotal(): (Basis - Rabatt) + Extras, auf Cent gerundet
    const extrasTotal = (extras.drinks ? dp * qty : 0) + (extras.insurance ? INSURANCE : 0) + (ff ? FREEFALL : 0);
    const total = round2(baseOnly - discount + extrasTotal);
    const vat = round2(total - total / (1 + VAT_RATE));
    return { base, pp, qty, baseOnly, discount, lines, extrasTotal: round2(extrasTotal), total, vat, drinksUnit: dp };
  }

  return {
    VAT_RATE, PRICES, KINDER_PRICES, SOCIAL_PRICE, DRINKS, INSURANCE, FREEFALL, MIN_QTY, MAX_QTY,
    EVENTS, ppForDay, minPP, drinksPrice, promoDiscount, quote, isSocial, round2,
  };
}));
