/**
 * Start: Schlüssel laden, Einstiegslinks auswerten (kompatibel zu v1).
 *   /?event=jga|firma|friends|kinder|schule|verein[&step=…]  → Event vorgewählt, weiter zum Termin
 *   /?b=ID                                                    → Admin-Link (vorbereitete Buchung)
 *   /#gutschein                                               → Gutschein-Kauf öffnen
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, S = TX.S;
  const params = new URLSearchParams(location.search);
  const startHash = location.hash;

  async function loadAdminLink(id) {
    try {
      const d = await TX.api.getLink(id);
      S.fc = true; S.linkId = id;
      S.event = P.EVENTS[d.eventKey] ? d.eventKey : 'jga';
      S.eventNameOverride = d.eventName || null;
      S.qty = parseInt(d.groupSize, 10) || 4; S.qtySeen = true;
      // Vom Admin festgelegte Preise gelten (wie v1)
      S.override = { pp: parseFloat(d.pricePerPerson) || 35, base: parseFloat(d.basePrice) || 40 };
      S.extras = { drinks: !!d.drinksFlat, insurance: !!d.insurance, freefall: !!d.freefall };
      if (d.date) { S.date = new Date(d.date + 'T12:00:00'); S.date.setHours(0, 0, 0, 0); S.dateStr = d.date; }
      S.time = d.time || null;
      S.bookingId = d.bookingId || null;
      const set = (sel, v) => { if (v) $(sel).value = v; };
      set('#fn', d.firstName); set('#ln', d.lastName); set('#em', d.email); set('#ph', d.phone);
      set('#org', d.companyName); set('#street', d.companyStreet); set('#zip', d.companyZip); set('#city', d.companyCity); set('#vat', d.ustId);
      S.detailsOk = true;
      $('#fcBanner').hidden = false;
      TX.renderEvents();
      TX.go(5);
    } catch (e) {
      $('#linkError').hidden = false;
      TX.go(1, true);
    }
  }

  (async function boot() {
    TX.initCalendar();
    TX.renderEvents();
    history.replaceState({ step: 1 }, '', `${location.pathname}${location.search}#event`);
    await TX.api.config();   // Stripe- und PayPal-Schlüssel (ohne: Hinweis statt Zahlungsfeld)

    const b = params.get('b'), ev = params.get('event');
    if (b) { await loadAdminLink(b); }
    else if (ev && P.EVENTS[ev]) { S.event = ev; TX.renderEvents(); TX.track.eventType(); TX.go(2); }
    else { TX.go(1, true); }

    TX.bindSheetButtons(document);
    if (startHash === '#gutschein') setTimeout(() => TX.openSheet('gift'), 300);
  })();
})();
