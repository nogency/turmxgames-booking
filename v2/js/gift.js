/**
 * Gutschein kaufen. API /api/giftcard (create-payment → Zahlung → finalize) unverändert zu v1.
 * Der Server berechnet den Betrag selbst und prüft die Zahlung, bevor der Code entsteht.
 */
(function () {
  'use strict';
  const TX = window.TX, $ = TX.$, $$ = TX.$$, cfg = TX.config;
  const GIFT = { min: 10, max: 500, shipping: 2.95, presets: [25, 50, 100, 150] };
  const G = { type: 'digital', amount: 50 };
  let gcStripe = null, gcCard = null, gcExpressElements = null, gcExpress = null, gcPp = false, busy = false;

  const total = () => Math.round((G.amount + (G.type === 'hardcopy' ? GIFT.shipping : 0)) * 100) / 100;

  function render() {
    $$('[data-gctype]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gctype === G.type)));
    $('#gcShip').hidden = G.type !== 'hardcopy';
    const custom = !!$('#gcCustom').value;
    $('#gcAmounts').innerHTML = GIFT.presets.map(a => `<button type="button" data-amt="${a}" aria-pressed="${!custom && G.amount === a}">${a} €</button>`).join('');
    $$('#gcAmounts button').forEach(b => b.addEventListener('click', () => { G.amount = +b.dataset.amt; $('#gcCustom').value = ''; render(); }));
    $('#gcTotal').textContent = Number.isFinite(total()) ? TX.eur(total()) : '-';
    if (gcExpressElements && Number.isFinite(total())) { try { gcExpressElements.update({ amount: Math.round(total() * 100) }); } catch (e) { /* */ } }
  }

  function validate() {
    const rules = [['#gcCustom', () => Number.isFinite(G.amount) && G.amount >= GIFT.min && G.amount <= GIFT.max], ['#gcFn'], ['#gcLn'], ['#gcEm', TX.isEmail]];
    if (G.type === 'hardcopy') rules.push(['#gcStreet'], ['#gcZip'], ['#gcCity']);
    if (!TX.validate(rules)) return null;
    const v = id => $('#' + id).value.trim();
    return {
      buyer: { firstName: v('gcFn'), lastName: v('gcLn'), email: v('gcEm') },
      shipping: G.type === 'hardcopy' ? { street: v('gcStreet'), zip: v('gcZip'), city: v('gcCity') } : null,
    };
  }
  const err = msg => { $('#gcError').textContent = msg || ''; };

  async function finalize(payload) {
    const { ok, data } = await TX.api.giftFinalize(payload);
    if (!ok || !data.code) throw new Error(data.error || 'Der Gutschein konnte nicht erstellt werden.');
    return data;
  }
  function done(d, email) {
    $('#giftForm').hidden = true; $('#giftDone').hidden = false;
    $('#gcDoneText').textContent = d.type === 'hardcopy'
      ? `Wir drucken den Gutschein und schicken ihn per Post. Eine Bestätigung ist unterwegs an ${email}.`
      : `Dein Gutschein ist als PDF unterwegs an ${email}.`;
    $('#gcDoneCode').textContent = d.code;
  }

  function ensureStripe() {
    if (gcStripe) return true;
    const pk = cfg.keys && cfg.keys.stripePk;
    if (typeof Stripe === 'undefined' || !pk) return false;
    try { gcStripe = Stripe(pk); } catch (e) { return false; }
    return true;
  }
  function mountCard() {
    if (gcCard) return true;
    if (!ensureStripe()) { $('#gcCard').innerHTML = '<span class="small">Kartenzahlung konnte nicht geladen werden. Bitte Seite neu laden oder PayPal nutzen.</span>'; return false; }
    gcCard = gcStripe.elements({ locale: 'de' }).create('card', { style: { base: { fontSize: '16px', color: '#161616' } }, hidePostalCode: true });
    gcCard.mount('#gcCard');
    gcCard.on('change', e => { $('#gcCardErr').textContent = e.error ? e.error.message : ''; });
    return true;
  }
  function mountExpress() {
    if (gcExpress || !ensureStripe()) return;
    gcExpressElements = gcStripe.elements({ mode: 'payment', amount: Math.round(total() * 100), currency: 'eur', locale: 'de' });
    gcExpress = gcExpressElements.create('expressCheckout', { paymentMethods: { paypal: 'never', link: 'never', amazonPay: 'never' }, buttonType: { applePay: 'buy', googlePay: 'buy' }, buttonHeight: 48, layout: { maxColumns: 1, maxRows: 2, overflow: 'auto' } });
    gcExpress.on('click', event => { if (validate()) event.resolve(); });
    gcExpress.on('confirm', async () => {
      if (busy) return; busy = true; err('');
      try {
        const v = validate(); if (!v) return;
        const { ok, data } = await TX.api.giftCreatePayment(G.amount, G.type);
        if (!ok || !data.clientSecret) throw new Error(data.error || 'Die Zahlung konnte nicht angelegt werden.');
        const { error } = await gcStripe.confirmPayment({ elements: gcExpressElements, clientSecret: data.clientSecret, confirmParams: { return_url: location.href }, redirect: 'if_required' });
        if (error) throw new Error(error.message);
        done(await finalize({ paymentIntentId: data.paymentIntentId, type: G.type, buyer: v.buyer, shipping: v.shipping }), v.buyer.email);
      } catch (e) { err(e.message); } finally { busy = false; }
    });
    gcExpress.mount('#gcExpress');
  }
  async function mountPaypal() {
    if (gcPp) return;
    const id = cfg.keys && cfg.keys.paypalClientId; if (!id) return;
    try { await TX.loadPayPal(id); } catch (e) { return; }
    const btns = window.paypalSDK.Buttons({
      fundingSource: window.paypalSDK.FUNDING.PAYPAL,
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal', height: 44 },
      onClick: (d, actions) => (validate() ? actions.resolve() : actions.reject()),
      createOrder: (d, a) => a.order.create({ purchase_units: [{ amount: { value: total().toFixed(2), currency_code: 'EUR' }, description: 'TurmX Games Gutschein' }] }),
      onApprove: async (d, a) => {
        if (busy) return; busy = true; err('');
        try {
          const v = validate(); if (!v) return;
          const auth = await a.order.authorize();
          const authId = auth && auth.purchase_units && auth.purchase_units[0].payments.authorizations[0].id;
          if (!authId) throw new Error('Die PayPal-Freigabe hat nicht geklappt. Bitte erneut versuchen.');
          done(await finalize({ paypalAuthId: authId, type: G.type, buyer: v.buyer, shipping: v.shipping }), v.buyer.email);
        } catch (e) { err(e.message); } finally { busy = false; }
      },
      onError: e => err('PayPal: ' + ((e && e.message) || e)),
    });
    if (btns.isEligible()) { await btns.render('#gcPaypal'); gcPp = true; }
  }

  $('#gcPayBtn').addEventListener('click', async () => {
    if (busy) return; err('');
    const v = validate(); if (!v) return;
    if (!mountCard()) { err('Kartenzahlung konnte nicht geladen werden. Bitte Seite neu laden.'); return; }
    busy = true; const btn = $('#gcPayBtn'); TX.busy([btn], 'Wird verarbeitet');
    try {
      const { ok, data } = await TX.api.giftCreatePayment(G.amount, G.type);
      if (!ok || !data.clientSecret) throw new Error(data.error || 'Die Zahlung konnte nicht angelegt werden.');
      const res = await gcStripe.confirmCardPayment(data.clientSecret, { payment_method: { card: gcCard, billing_details: { name: `${v.buyer.firstName} ${v.buyer.lastName}`, email: v.buyer.email } } });
      if (res.error) throw new Error(res.error.message);
      done(await finalize({ paymentIntentId: data.paymentIntentId, type: G.type, buyer: v.buyer, shipping: v.shipping }), v.buyer.email);
    } catch (e) { err(e.message); } finally { busy = false; TX.unbusy([btn]); }
  });

  $$('[data-gctype]').forEach(b => b.addEventListener('click', () => { G.type = b.dataset.gctype; render(); }));
  $('#gcCustom').addEventListener('input', e => { const v = parseFloat(e.target.value.replace(',', '.')); G.amount = Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; render(); });

  TX.onSheetOpen('gift', () => {
    $('#giftForm').hidden = false; $('#giftDone').hidden = true; err('');
    render(); mountCard(); mountExpress(); mountPaypal();
    TX.track.giftcardOpen();
  });
})();
