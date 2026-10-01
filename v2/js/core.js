/**
 * TurmX Buchung v2 – Kern: Namensraum, Zustand, Hilfsfunktionen.
 * Alle Module hängen an window.TX. Ladereihenfolge siehe index.html.
 */
(function () {
  'use strict';
  const TX = (window.TX = window.TX || {});
  const P = window.TXPricing;

  TX.config = {
    API: '/api/bookla',
    SERVICE_ID: '8bd533a6-a6a2-4abb-b170-134b6aab74ce',  // ein Bookla-Service für alle Eventarten
    MIN_LEAD_DAYS: 3,
    SLOT_TIMES: ['10:00', '13:00', '16:00', '19:00'],      // nur für "Termine abstimmen"
    PHONE: '0172 585 00 55',
    PHONE_TEL: '+491725850055',
    keys: null,                                             // { stripePk, paypalClientId } aus /api/config
    // Bewertungen (Stand 2026-10-01, bei Änderung hier pflegen)
    reviews: {
      google: { rating: 5.0, count: 204, label: 'Rezensionen' },
      tripadvisor: { rating: 4.8, count: 46, label: 'Bewertungen' },
    },
    payLogos: [
      ['pay-visa.svg', 'Visa'], ['pay-master.svg', 'Mastercard'], ['pay-american_express.svg', 'American Express'], ['pay-paypal.svg', 'PayPal'],
      ['pay-apple_pay.svg', 'Apple Pay'], ['pay-google_pay.svg', 'Google Pay'], ['pay-sepadirectdebit.svg', 'SEPA-Lastschrift'],
    ],
  };

  // ── Zustand der Buchung ──
  TX.S = {
    step: 1,
    event: null,            // jga | firma | friends | kinder | schule | verein
    date: null, dateStr: null, time: null,
    qty: 8, qtySeen: false, age: null,
    extras: { drinks: false, insurance: false, freefall: false },
    promo: { code: null, def: null },
    payMethod: 'cc',        // cc | sepa | paypal | invoice (Werte wie v1, landen im Tracking)
    detailsOk: false,
    fc: false,              // Admin-Link (Fast Checkout)
    linkId: null, bookingId: null, override: null,
    availDates: new Set(), availMonth: null,
  };

  // ── DOM ──
  TX.$ = s => document.querySelector(s);
  TX.$$ = s => Array.from(document.querySelectorAll(s));
  TX.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  TX.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  TX.isAndroid = /Android/i.test(navigator.userAgent);
  TX.delay = ms => new Promise(r => setTimeout(r, ms));

  // ── Format ──
  TX.eur = n => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  TX.eurShort = n => (Number.isInteger(n) ? n + ' €' : TX.eur(n));
  TX.comma = n => n.toFixed(2).replace('.', ',');
  const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const WDS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  TX.MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  TX.fmtDateShort = d => `${WDS[d.getDay()]}, ${d.getDate()}. ${TX.MONTHS[d.getMonth()].slice(0, 3)}.`;
  TX.fmtDateLong = d => `${WD[d.getDay()]}, ${d.getDate()}. ${TX.MONTHS[d.getMonth()]}`;
  TX.isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  TX.today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
  TX.minDate = () => { const t = TX.today(); t.setDate(t.getDate() + TX.config.MIN_LEAD_DAYS); return t; };

  // ── Abgeleitete Werte ──
  // Admin-Link bringt eigenen Eventnamen mit (wie v1: S.eventName = d.eventName)
  TX.eventName = () => TX.S.eventNameOverride || (TX.S.event ? P.EVENTS[TX.S.event].name : '');
  TX.needsOrg = () => TX.S.event === 'firma' || P.isSocial(TX.S.event);
  TX.quote = () => TX.S.event && P.quote({
    event: TX.S.event,
    dow: TX.S.date ? TX.S.date.getDay() : null,
    qty: TX.S.qty,
    extras: TX.S.extras,
    promoDef: TX.S.promo.def,
    override: TX.S.override,
  });
  TX.total = () => { const q = TX.quote(); return q ? q.total : 0; };

  // Kontaktfelder (Formular in Schritt 4) gebündelt lesen
  TX.contact = () => {
    const v = id => (TX.$('#' + id) ? TX.$('#' + id).value.trim() : '');
    return {
      firstName: v('fn'), lastName: v('ln'), email: v('em'), phone: v('ph'),
      companyName: TX.needsOrg() ? v('org') || null : null,
      companyStreet: TX.needsOrg() ? v('street') || null : null,
      companyZip: TX.needsOrg() ? v('zip') || null : null,
      companyCity: TX.needsOrg() ? v('city') || null : null,
      ustId: TX.S.event === 'firma' ? v('vat') || null : null,
      wishes: v('wish'),
    };
  };

  // Mini-Ereignisbus: Module melden Änderungen, Navigation/Leiste rendern neu
  const listeners = [];
  TX.onChange = fn => listeners.push(fn);
  TX.changed = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error('[TX]', e); } });
})();
