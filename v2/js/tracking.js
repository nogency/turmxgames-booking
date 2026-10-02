/**
 * TurmX Buchung v2 – Tracking (alle dataLayer-Events an EINER Stelle).
 *
 * VERTRAG mit dem GTM (GTM-W4S2PD8F), Stand 2026-10-01:
 *   - Trigger hören auf "purchase". Daran hängen Google Ads (AW-10906079154), GA4, Meta.
 *   - Gelesen werden: ecommerce.value, ecommerce.currency, ecommerce.transaction_id,
 *     ecommerce.payment_type, ecommerce.items.
 *   → purchase MUSS in Name, Feldern und Zeitpunkt identisch zu v1 bleiben
 *     (erst nach erfolgreicher Buchung, nicht bei "wird verarbeitet"/Duplikat).
 *
 * Alle übrigen Events sind wie in v1 benannt. Neu: GA4-Standard-Events begin_checkout und
 * add_payment_info für den Buchungs-Trichter (Tags dafür im GTM anlegen).
 */
(function () {
  'use strict';
  const TX = window.TX;
  window.dataLayer = window.dataLayer || [];
  const push = obj => window.dataLayer.push(obj);

  const STEP_NAMES = { 1: 'event', 2: 'termin', 3: 'gruppe', 4: 'daten', 5: 'zahlung' };
  let checkoutStarted = false;

  const item = () => ({ item_id: TX.S.event, item_name: TX.eventName(), price: TX.total(), quantity: TX.S.qty });

  TX.track = {
    eventType() { push({ event: 'select_event_type', event_type: TX.S.event, event_name: TX.eventName() }); },
    date() { push({ event: 'select_date', date: TX.S.dateStr, event_type: TX.S.event }); },
    time() { push({ event: 'select_time', time: TX.S.time, date: TX.S.dateStr, event_type: TX.S.event }); },
    extra(name, on, price) { push({ event: on ? 'add_extra' : 'remove_extra', extra: name, price }); },
    progress(step) {
      if (!STEP_NAMES[step]) return;
      push({ event: 'checkout_progress', step, step_name: STEP_NAMES[step], event_type: TX.S.event, value: TX.total(), currency: 'EUR' });
      if (step >= 2 && !checkoutStarted && TX.S.event) {
        checkoutStarted = true;
        push({ ecommerce: null });
        push({ event: 'begin_checkout', ecommerce: { currency: 'EUR', value: TX.total(), items: [item()] } });
      }
    },
    paymentMethod(m) {
      push({ event: 'select_payment_method', payment_method: m, value: TX.total(), currency: 'EUR' });
    },
    addPaymentInfo(m) {
      push({ ecommerce: null });
      push({ event: 'add_payment_info', ecommerce: { currency: 'EUR', value: TX.total(), payment_type: m, items: [item()] } });
    },
    /** Identisch zu v1 (siehe Vertrag oben). */
    purchase(ref, paymentType) {
      push({ ecommerce: null });
      push({ event: 'purchase', ecommerce: { transaction_id: ref, value: TX.total(), currency: 'EUR', payment_type: paymentType, items: [item()] } });
    },
    inquiry(size, type) { push({ event: 'inquiry_submitted', group_size: size, event_type: type }); },
    giftcardOpen() { push({ event: 'giftcard_open' }); },
  };
})();
