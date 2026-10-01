/**
 * Navigation: Schritte, Fortschrittsleiste, Kontext-Chips, Preisleiste, Erfolgsseite.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;
  const DONE = 6;
  const CTA = { 1: 'Weiter', 2: 'Weiter', 3: 'Weiter', 4: 'Weiter zur Zahlung', 5: 'Zahlungspflichtig buchen' };
  const HASH = ['', 'event', 'termin', 'gruppe', 'daten', 'zahlung', 'fertig'];
  const ICON = { jga: 'ph-champagne', firma: 'ph-buildings', friends: 'ph-users-three', kinder: 'ph-cake', schule: 'ph-graduation-cap', verein: 'ph-graduation-cap' };

  TX.go = (n, fromHistory) => {
    const back = n < S.step;
    if (n >= 3) S.qtySeen = true;
    S.step = n;
    $$('.step').forEach(s => { const on = +s.dataset.step === n; s.classList.toggle('is-active', on); s.classList.toggle('is-back', on && back); });
    if (!fromHistory) history.pushState({ step: n }, '', `${location.pathname}${location.search}#${HASH[n]}`);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (n === 2) { TX.renderDayHint(); TX.renderCal(); if (S.dateStr) { $('#slotBlock').hidden = false; TX.loadSlots(); } }
    if (n === 3) { TX.renderQty(); TX.renderExtras(); }
    if (n === 4) TX.renderOrg();
    if (n === 5) TX.renderPay();
    TX.track.progress(n);
    TX.changed();
    const h = $(`#h1-${n}`); if (h) h.focus({ preventScroll: true });
  };

  TX.next = () => {
    if (S.step === 1) { if (!S.event) { $('#err-1').classList.add('show'); return; } TX.go(2); }
    else if (S.step === 2) {
      if (!S.dateStr) { $('#err-2d').classList.add('show'); $('#cal').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (!S.time) { $('#err-2t').classList.add('show'); $('#slotBlock').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      TX.go(3);
    }
    else if (S.step === 3) TX.go(4);
    else if (S.step === 4) { if (TX.validateDetails()) { S.detailsOk = true; TX.go(5); } }
    else if (S.step === 5) TX.pay();
  };

  // Welche Schritte sind über die Leiste erreichbar? Nur mit vollständigen Vorgaben.
  TX.canGo = n => {
    if (S.step === DONE) return false;
    if (S.fc) return n === 5;   // Admin-Link: vorbereitet, nur bezahlen
    if (n === 1) return true;
    if (n === 2) return !!S.event;
    if (n === 3) return !!(S.event && S.dateStr && S.time);
    if (n === 4) return TX.canGo(3) && S.qtySeen;
    if (n === 5) return TX.canGo(4) && S.detailsOk;
    return false;
  };

  /** Erfolgsseite. ref = Buchungsnummer oder null (wird verarbeitet / Duplikat) */
  TX.showDone = (ref, opts = {}) => {
    const c = TX.contact();
    $('#doneRef').textContent = ref || 'folgt per E-Mail';
    $('#doneLead').textContent = opts.confirmationFailed
      ? 'Eure Buchung ist eingegangen. Die Auftragsbestätigung schicken wir in Kürze separat per E-Mail.'
      : ref ? `Die Bestätigung ist unterwegs an ${c.email}.` : `Eure Buchung wird gerade verarbeitet. Die Bestätigung kommt per E-Mail an ${c.email}.`;
    $('#doneCard').innerHTML = TX.summaryHtml(false);
    $('#doneStorno').textContent = TX.stornoText();
    TX.go(DONE);
  };

  function render() {
    // Fortschritt
    $$('.progress li').forEach(li => {
      const p = +li.dataset.p, b = li.querySelector('.pstep');
      li.classList.toggle('done', p < S.step); li.classList.toggle('now', p === S.step);
      b.disabled = !TX.canGo(p);
      if (p === S.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.setAttribute('aria-label', `Schritt ${p}: ${b.textContent.trim()}${p < S.step ? ' (erledigt)' : ''}`);
    });
    $('.progress').hidden = !!S.fc;
    const noBack = S.step === 1 || S.step === DONE || S.fc;
    $('#backBtn').classList.toggle('is-hidden', noBack); $('#backBtn').tabIndex = noBack ? -1 : 0;

    // Kontext-Chips (gewählte Werte, antippen = ändern)
    const chips = [];
    if (S.event) chips.push(`<button class="chip" type="button" data-go="1"><i class="ph ${ICON[S.event]}"></i>${TX.esc(TX.cardFor(S.event).name)}</button>`);
    if (S.dateStr && S.time && S.step > 2) chips.push(`<button class="chip" type="button" data-go="2"><i class="ph ph-calendar-blank"></i>${TX.fmtDateShort(S.date)}, ${S.time} Uhr</button>`);
    $$('[data-chips]').forEach(el => { el.innerHTML = S.fc ? '' : chips.join(''); el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => TX.go(+b.dataset.go))); });

    // Preis unten: "pro Person", bis die Personenzahl feststeht
    const q = TX.quote();
    if (!q) { $('#barK').textContent = 'Preise'; $('#barV').textContent = `ab ${P.KINDER_PRICES.weekday} €`; }
    else if (!S.qtySeen) { $('#barK').textContent = S.event === 'kinder' ? 'pro Kind' : 'pro Person'; $('#barV').textContent = (S.dateStr ? '' : 'ab ') + TX.eurShort(q.pp); }
    else { $('#barK').textContent = 'inkl. MwSt.'; $('#barV').textContent = TX.eur(q.total); }
    $('#barCaret').hidden = !S.qtySeen;
    $$('[data-cta]').forEach(b => { if (b.getAttribute('aria-busy') !== 'true') b.textContent = CTA[S.step] || ''; });
    $('#bar').hidden = S.step === DONE;
    $('.side').hidden = S.step === DONE;
    $('#sideCard').hidden = !S.event;   // leere Karte erst zeigen, wenn etwas gewählt ist
    $('#sideSum').innerHTML = TX.summaryHtml(true);
    $$('#sideSum [data-go]').forEach(b => b.addEventListener('click', () => TX.go(+b.dataset.go)));
    // Codefeld, sobald ein Preis feststeht (Desktop: Seitenleiste, mobil: Preisübersicht)
    TX.syncPromo($('#sidePromo'), S.qtySeen && !S.fc);
    TX.syncPromo($('#sheetPromo'), S.qtySeen && !S.fc);
    if ($('#sheet-price').classList.contains('open')) TX.renderPriceSheet();
    if (S.step === 5) TX.renderSummary();
  }
  TX.onChange(render);

  // ── Verdrahtung ──
  $$('[data-cta]').forEach(b => b.addEventListener('click', TX.next));
  $$('.pstep').forEach(b => b.addEventListener('click', () => { const p = +b.dataset.p; if (TX.canGo(p) && p !== S.step) TX.go(p); }));
  $('#backBtn').addEventListener('click', () => history.back());
  $('#barPrice').addEventListener('click', () => { if (S.qtySeen) TX.openSheet('price'); });
  window.addEventListener('popstate', e => {
    $$('.sheet.open').forEach(TX.closeSheet);
    if (S.step === DONE) { history.pushState({ step: DONE }, '', '#fertig'); return; }   // nach Buchung nicht zurück
    if (S.fc) { history.pushState({ step: 5 }, '', '#zahlung'); return; }
    const n = e.state && e.state.step;
    if (n >= 1 && n <= 5 && TX.canGo(n)) TX.go(n, true);
  });

  // ── Kalendereintrag (.ics) ──
  $('#icsBtn').addEventListener('click', () => {
    if (!S.date || !S.time) return;
    const [h, m] = S.time.split(':').map(Number);
    const start = new Date(S.date); start.setHours(h, m, 0, 0);
    const end = new Date(start.getTime() + P.EVENTS[S.event].minutes * 60000);
    const f = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TurmX Games//Buchung//DE', 'BEGIN:VEVENT', `UID:${Date.now()}@turmxgames.de`, `DTSTAMP:${f(new Date())}`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`, `SUMMARY:TurmX Games: ${TX.eventName()}`, 'LOCATION:TurmX Games, Kurfürstenstraße 58-60, 50321 Brühl', 'DESCRIPTION:Bitte 15 Minuten vor Beginn da sein.', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'turmx-games.ics'; a.click();
  });
})();
