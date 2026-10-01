/**
 * Zahlung + Buchung. Logik aus v1 übernommen (inkl. Fixes 213dab6, fc6b3f1, bbd483c, 78e014a):
 *  - Karte/SEPA nur mit geladenem Stripe (nie ohne Zahlung buchen)
 *  - Globale Sperre gegen Doppel-Absenden (Button, Leiste, Wallet, PayPal)
 *  - 202 "wird verarbeitet" / 409 Duplikat = Erfolg ohne purchase-Event, nicht erneut senden
 *  - Rechnung: confirmationFailed → ehrlicher Hinweis
 *  - Admin-Link: confirm-admin-booking statt neuer Buchung
 * Anfragen und Bookla-Notizen 1:1 wie v1.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S, cfg = TX.config;
  const STRIPE_MISSING = 'Karten- und SEPA-Zahlung konnten nicht geladen werden, oft wegen eines Werbeblockers. Bitte ladet die Seite neu oder bezahlt mit PayPal.';

  let stripe = null, cardEl = null, ibanEl = null, ecElements = null, ecEl = null, stripeReady = false;
  let expressStripeOk = false, ppRendered = false, isSubmitting = false;

  // ═════════ Stripe ═════════
  function initStripe() {
    if (stripeReady) return;
    const pk = cfg.keys && cfg.keys.stripePk;
    if (typeof Stripe === 'undefined' || !pk) { showStripeMissing(); return; }
    try { stripe = Stripe(pk); } catch (e) { showStripeMissing(); return; }
    stripeReady = true;
    $('#stripeCard').innerHTML = ''; $('#stripeIban').innerHTML = '';
    // 16px verhindert das Auto-Zoomen von iOS beim Tippen
    const style = { base: { color: '#161616', fontFamily: 'Geist, system-ui, sans-serif', fontSize: '16px', '::placeholder': { color: '#8a8a8a' } }, invalid: { color: '#b3261e' } };
    const elements = stripe.elements({ fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap' }], locale: 'de' });
    cardEl = elements.create('card', { style, hidePostalCode: true });
    cardEl.mount('#stripeCard'); bindField(cardEl, '#stripeCard', '#cardErr');
    ibanEl = elements.create('iban', { style, supportedCountries: ['SEPA'], placeholderCountry: 'DE' });
    ibanEl.mount('#stripeIban'); bindField(ibanEl, '#stripeIban', '#ibanErr');
    initExpressStripe();
  }
  function bindField(el, box, msg) {
    el.on('change', e => { $(msg).textContent = e.error ? e.error.message : ''; $(box).classList.toggle('is-error', !!e.error); });
    el.on('focus', () => $(box).classList.add('is-focus'));
    el.on('blur', () => $(box).classList.remove('is-focus'));
  }
  function showStripeMissing() {
    const note = `<span class="small">${STRIPE_MISSING}</span>`;
    $('#stripeCard').innerHTML = note; $('#stripeIban').innerHTML = note;
  }
  async function ensureStripe() {
    if (!stripe) initStripe();
    if (!stripe) { await TX.delay(1200); initStripe(); }
    return !!stripe;
  }

  // Apple Pay / Google Pay über Stripe Express Checkout
  function initExpressStripe() {
    if (ecEl || !stripe) return;
    ecElements = stripe.elements({ mode: 'payment', amount: amountCents(), currency: 'eur', locale: 'de' });
    ecEl = ecElements.create('expressCheckout', {
      paymentMethods: { paypal: 'never', link: 'never', amazonPay: 'never' },
      buttonType: { applePay: 'buy', googlePay: 'buy' }, buttonHeight: 50,
      layout: { maxColumns: 1, maxRows: 2, overflow: 'auto' },
    });
    ecEl.on('ready', ({ availablePaymentMethods }) => {
      expressStripeOk = !!availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean);
      updateExpressBlock();
    });
    ecEl.on('click', event => { if (guard()) event.resolve(); });
    ecEl.on('confirm', async () => {
      if (isSubmitting) return; isSubmitting = true;
      S.payMethod = 'cc';   // wie v1: Wallet-Zahlungen laufen als Karte
      hidePayError();
      try {
        const { ok, data } = await TX.api.createPaymentIntent(TX.total());
        if (!ok || !data.clientSecret) throw new Error(data.error || 'Die Zahlung konnte nicht angelegt werden.');
        const { error, paymentIntent } = await stripe.confirmPayment({ elements: ecElements, clientSecret: data.clientSecret, confirmParams: { return_url: location.href }, redirect: 'if_required' });
        if (error) throw new Error(error.message);
        await submitBooking(paymentIntent && paymentIntent.id, null);
      } catch (e) { showPayError(e.message); }
      finally { isSubmitting = false; }
    });
    ecEl.mount('#expressStripe');
  }
  const amountCents = () => Math.max(50, Math.round(TX.total() * 100));
  TX.onChange(() => { if (ecElements) { try { ecElements.update({ amount: amountCents() }); } catch (e) { /* noch nicht bereit */ } } });

  // ═════════ PayPal (Autorisieren → erst nach erfolgreicher Buchung einziehen, serverseitig) ═════════
  let ppSdk = null;
  TX.loadPayPal = clientId => {
    if (ppSdk) return ppSdk;
    ppSdk = new Promise((resolve, reject) => {
      if (window.paypalSDK) { resolve(); return; }
      const s = document.createElement('script');
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=authorize&components=buttons`;
      s.setAttribute('data-namespace', 'paypalSDK');
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
    return ppSdk;
  };
  async function initPayPal() {
    if (ppRendered) return;
    const id = cfg.keys && cfg.keys.paypalClientId; if (!id) return;
    try { await TX.loadPayPal(id); } catch (e) { return; }
    const btn = window.paypalSDK.Buttons({
      fundingSource: window.paypalSDK.FUNDING.PAYPAL,
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 48 },
      onClick: (d, actions) => (guard() ? actions.resolve() : actions.reject()),
      createOrder: (d, a) => a.order.create({ purchase_units: [{ amount: { value: TX.total().toFixed(2), currency_code: 'EUR' }, description: 'TurmX Games – ' + TX.eventName() }] }),
      onApprove: async (d, a) => {
        if (isSubmitting) return; isSubmitting = true;
        hidePayError();
        try {
          const auth = await a.order.authorize();
          const authId = auth && auth.purchase_units && auth.purchase_units[0].payments && auth.purchase_units[0].payments.authorizations && auth.purchase_units[0].payments.authorizations[0].id;
          if (!authId) { showPayError('Die PayPal-Freigabe hat nicht geklappt. Bitte erneut versuchen.'); return; }
          S.payMethod = 'paypal';
          await submitBooking(null, authId);
        } catch (e) { showPayError(e.message); }
        finally { isSubmitting = false; }
      },
      onError: e => showPayError('PayPal: ' + ((e && e.message) || e)),
    });
    if (btn.isEligible()) { await btn.render('#expressPaypal'); ppRendered = true; updateExpressBlock(); }
  }
  function updateExpressBlock() { $('#expressBlock').hidden = !(expressStripeOk || ppRendered); }

  // ═════════ Schritt 5 vorbereiten ═════════
  TX.renderPay = () => {
    const needs = TX.needsOrg();
    const inv = $('#payInvoice'), inp = inv.querySelector('input');
    inp.disabled = !needs; inv.classList.toggle('disabled', !needs);
    $('#invoiceSub').textContent = needs ? 'Auftragsbestätigung sofort, Rechnung nach dem Event' : 'Nur für Firmen, Schulen und Vereine';
    if (!needs && inp.checked) $('input[name=pay][value=cc]').checked = true;
    const c = TX.contact();
    if (!$('#sepaName').value) $('#sepaName').value = `${c.firstName} ${c.lastName}`.trim();
    initStripe(); initPayPal();
  };
  $$('input[name=pay]').forEach(r => r.addEventListener('change', () => { S.payMethod = r.value; TX.track.paymentMethod(r.value); }));
  const selectedMethod = () => ($('input[name=pay]:checked') || {}).value || 'cc';

  // Vor jeder Zahlung: Termin + Daten vollständig? Sonst dorthin zurück.
  function guard() {
    if (isSubmitting) return false;
    if (!S.dateStr || !S.time) { TX.go(2); return false; }
    if (!TX.validateDetails(true)) { TX.go(4); setTimeout(() => TX.validateDetails(), 60); return false; }
    return true;
  }

  // ═════════ Hauptbutton "Zahlungspflichtig buchen" ═════════
  TX.pay = async () => {
    if (!guard()) return;
    const m = selectedMethod(); S.payMethod = m;
    TX.track.addPaymentInfo(m);
    isSubmitting = true; hidePayError();
    const ctas = $$('[data-cta]'); TX.busy(ctas, 'Wird gebucht');
    try {
      if (m === 'invoice') { await submitInvoice(); return; }
      if (!(await ensureStripe())) { showPayError(STRIPE_MISSING); return; }
      const c = TX.contact();
      if (m === 'cc') {
        const { ok, data } = await TX.api.createPaymentIntent(TX.total());
        if (!ok || !data.clientSecret) throw new Error(data.error || 'Die Zahlung konnte nicht angelegt werden.');
        const res = await stripe.confirmCardPayment(data.clientSecret, { payment_method: { card: cardEl, billing_details: { name: `${c.firstName} ${c.lastName}`.trim(), email: c.email } } });
        if (res.error) throw new Error(res.error.message);
        await submitBooking(res.paymentIntent.id, null);
        return;
      }
      if (m === 'sepa') {
        if (!TX.validate([['#sepaName']])) return;
        const { ok, data } = await TX.api.createPaymentIntent(TX.total(), 'sepa_debit');
        if (!ok || !data.clientSecret) throw new Error(data.error || 'Die SEPA-Lastschrift konnte nicht angelegt werden.');
        const { error, paymentIntent } = await stripe.confirmSepaDebitPayment(data.clientSecret, { payment_method: { sepa_debit: ibanEl, billing_details: { name: $('#sepaName').value.trim(), email: c.email } } });
        if (error) throw new Error(error.message);
        await submitBooking(paymentIntent && paymentIntent.id, null);   // SEPA: "processing" gilt als Erfolg (wie v1)
      }
    } catch (e) {
      showPayError(e.message || 'Zahlung fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      isSubmitting = false; TX.unbusy(ctas); TX.changed();
    }
  };

  // ═════════ Buchung anlegen ═════════
  async function submitBooking(paymentId, paypalAuthId) {
    if (S.fc && S.bookingId) return confirmAdmin(paypalAuthId);
    const c = TX.contact();
    const { ok, status, data } = await TX.api.createBooking({
      serviceId: cfg.SERVICE_ID, date: S.dateStr, time: S.time, groupSize: S.qty,
      firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone,
      notes: TX.bookingNotes(),
      paymentIntentId: paymentId || null, paypalAuthId: paypalAuthId || null,
      promoCode: S.promo.code || null,
    });
    // Duplikat oder unklare Bookla-Antwort: NICHT als Fehler, NICHT erneut senden
    if ((status === 202 && data.processing) || (status === 409 && data.duplicate)) { TX.showDone(null); return; }
    if (!ok) throw new Error(data.error || 'Buchung fehlgeschlagen');
    if (!data.id) throw new Error('Keine Buchungs-ID erhalten');
    const ref = 'BKL-' + String(data.id).slice(-6).toUpperCase();
    TX.showDone(ref);
    TX.track.purchase(ref, S.payMethod);
    sendConfirmation(data.id);
  }

  async function submitInvoice() {
    if (S.fc && S.bookingId) return confirmAdmin(null);
    const c = TX.contact(), q = TX.quote();
    const { ok, status, data } = await TX.api.createBookingInvoice({
      serviceId: cfg.SERVICE_ID, date: S.dateStr, time: S.time, groupSize: S.qty,
      firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone || null,
      serviceName: TX.eventName(), amount: q.total, notes: TX.bookingNotes('invoice'),
      drinksFlat: S.extras.drinks, insurance: S.extras.insurance,
      baseAmount: P.round2(q.baseOnly - q.discount),
      companyName: c.companyName, companyStreet: c.companyStreet, companyZip: c.companyZip, companyCity: c.companyCity, ustId: c.ustId,
      promoCode: S.promo.code || null,
    });
    if ((status === 202 && data.processing) || (status === 409 && data.duplicate)) { TX.showDone(null); return; }
    if (!ok) throw new Error(data.error || 'Buchung fehlgeschlagen');
    const ref = data.id ? 'BKL-' + String(data.id).slice(-6).toUpperCase() : 'GSH-' + Math.floor(100000 + Math.random() * 900000);
    TX.track.purchase(ref, 'invoice');
    TX.showDone(ref, { confirmationFailed: !!data.confirmationFailed });
  }

  async function confirmAdmin(paypalAuthId) {
    const { ok, data } = await TX.api.confirmAdminBooking({ bookingId: S.bookingId, paypalAuthId: paypalAuthId || null, notes: TX.bookingNotes(), adminLinkId: S.linkId });
    if (!ok) throw new Error(data.error || 'Bestätigung fehlgeschlagen');
    const ref = 'BKL-' + String(S.bookingId).slice(-6).toUpperCase();
    TX.showDone(ref);
    TX.track.purchase(ref, S.payMethod);
    sendConfirmation(S.bookingId);
  }

  // Auftragsbestätigung (PDF + Mail) nach Karte/PayPal/SEPA, wie v1 im Hintergrund
  function sendConfirmation(bookingId) {
    const c = TX.contact(), q = TX.quote();
    TX.api.sendConfirmation({
      bookingId, serviceName: TX.eventName(), groupSize: S.qty,
      amount: q.total, baseAmount: P.round2(q.total - q.extrasTotal),
      drinksFlat: S.extras.drinks, drinksPrice: q.drinksUnit, insurance: S.extras.insurance, freefall: S.extras.freefall && S.event === 'jga',
      paymentMethod: S.payMethod, date: S.dateStr, time: S.time,
      firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone || null,
      companyName: c.companyName, companyStreet: c.companyStreet, companyZip: c.companyZip, companyCity: c.companyCity, ustId: c.ustId,
    }).then(r => { if (!r.ok) console.error('[KRITISCH] Auftragsbestätigung fehlgeschlagen', r.status, 'bookingId:', bookingId); })
      .catch(e => console.error('[KRITISCH] Auftragsbestätigung fehlgeschlagen', e && e.message, 'bookingId:', bookingId));
  }

  /** Notizen für Bookla: Format 1:1 wie v1 (Team liest diese im Dashboard). */
  TX.bookingNotes = pm => {
    pm = pm || S.payMethod;
    const label = { cc: 'Kreditkarte', sepa: 'SEPA-Lastschrift', paypal: 'PayPal', invoice: 'Auf Rechnung' }[pm] || pm;
    const q = TX.quote(), c = TX.contact();
    return [
      '--- BUCHUNGSDETAILS ---',
      'Event: ' + TX.eventName(),
      'Personen: ' + S.qty + (q.pp ? ' (' + TX.comma(q.pp) + '€/Person)' : ''),
      'Gesamtpreis: ' + TX.comma(q.total) + ' EUR',
      S.promo.code ? 'Rabatt-Code: ' + S.promo.code + ' (−' + TX.comma(q.discount) + '€)' : null,
      'Getränkeflat: ' + (S.extras.drinks ? 'Ja (' + S.qty + ' × ' + TX.comma(q.drinksUnit) + '€)' : 'Nein'),
      'Versicherung: ' + (S.extras.insurance ? 'Ja (14,90€)' : 'Nein'),
      'Freefall Mutprobe: ' + (S.extras.freefall && S.event === 'jga' ? 'Ja (30,00€)' : 'Nein'),
      'Zahlung: ' + label,
      c.phone ? 'Telefon: ' + c.phone : null,
      S.age ? 'Alter Geburtstagskind: ' + S.age : null,
      c.companyName ? 'Firma: ' + c.companyName : null,
      c.wishes ? 'Wünsche: ' + c.wishes : null,
      '----------------------',
    ].filter(Boolean).join('\n');
  };

  function showPayError(msg) {
    $('#payErrorMsg').textContent = msg || 'Unbekannter Fehler.';
    $('#payError').classList.add('show');
    if (S.step !== 5) TX.go(5);
    $('#payError').scrollIntoView({ behavior: TX.reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }
  function hidePayError() { $('#payError').classList.remove('show'); }

  // Für Tests: Zustand zurücksetzen / Stripe-Instanz austauschen
  TX._payment = { setStripe: s => { stripe = s; stripeReady = !!s; }, reset: () => { isSubmitting = false; } };
})();
