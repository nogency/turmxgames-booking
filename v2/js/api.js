/**
 * TurmX Buchung v2 – alle Aufrufe an /api an einer Stelle.
 * Anfragen sind 1:1 die von v1 (gleiche Felder) → Server bleibt für v2 unverändert.
 */
(function () {
  'use strict';
  const TX = window.TX;
  const cfg = TX.config;

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (e) { data = {}; }
    return { ok: r.ok, status: r.status, data };
  }
  const bookla = (action, body) => post(`${cfg.API}?action=${action}`, body);

  TX.api = {
    async config() {
      try { const r = await fetch('/api/config'); if (r.ok) cfg.keys = await r.json(); } catch (e) { /* Stripe/PayPal zeigen dann Hinweis */ }
      return cfg.keys;
    },
    async availableDates(year, month1) {
      try {
        const { data } = await bookla('available-dates', { serviceId: cfg.SERVICE_ID, year, month: month1 });
        if (Array.isArray(data)) return new Set(data);
        if (data && Array.isArray(data.dates)) return new Set(data.dates);
      } catch (e) { /* leer = alle Tage anzeigen (wie v1) */ }
      return new Set();
    },
    /** → [{ startAt, available, spots, freeSlots }] oder wirft bei Fehler */
    async availableTimes(dateStr, groupSize) {
      const { ok, data } = await bookla('available-times', { serviceId: cfg.SERVICE_ID, date: dateStr, groupSize });
      if (!ok) throw new Error('times ' + (data && data.error));
      return Array.isArray(data) ? data : (data.times || []);
    },
    validateCode(code) {
      const S = TX.S;
      return bookla('validate-code', { code, serviceId: cfg.SERVICE_ID, date: S.dateStr, time: S.time, groupSize: S.qty });
    },
    createPaymentIntent(amount, paymentMethodType) {
      return bookla('create-payment-intent', { amount, description: 'TurmX Games – ' + TX.eventName(), ...(paymentMethodType && { paymentMethodType }) });
    },
    createBooking(payload) { return bookla('create-booking', payload); },
    createBookingInvoice(payload) { return bookla('create-booking-invoice', payload); },
    confirmAdminBooking(payload) { return bookla('confirm-admin-booking', payload); },
    sendConfirmation(payload) { return post('/api/invoice?action=create-invoice', payload); },
    async getLink(id) {
      const r = await fetch(`/api/get-link?id=${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error('link');
      return r.json();
    },
    inquiry(body) { return post('/api/inquiry', body); },
    giftCreatePayment(amount, type) { return post('/api/giftcard?action=create-payment', { amount, type }); },
    giftFinalize(body) { return post('/api/giftcard?action=finalize', body); },
  };
})();
