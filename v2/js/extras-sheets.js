/**
 * Weitere Dialoge: Großgruppen-Anfrage, Termine abstimmen, Freefall, Preisübersicht, Cookies.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S, cfg = TX.config;

  // ── Großgruppen-Anfrage (/api/inquiry, Felder wie v1) ──
  const INQ_TYPE = { jga: 'JGA', firma: 'Firmenevent', friends: 'Geburtstag', kinder: 'Geburtstag', schule: 'Sonstiges', verein: 'Sonstiges' };
  TX.onSheetOpen('inquiry', () => {
    $('#inqForm').hidden = false; $('#inqDone').hidden = true; $('#iqError').textContent = '';
    if (S.qty >= P.MAX_QTY && !$('#iqSize').value) $('#iqSize').value = 33;
    if (S.event && INQ_TYPE[S.event]) $('#iqType').value = INQ_TYPE[S.event];
  });
  $('#iqSend').addEventListener('click', async e => {
    if (!TX.validate([['#iqName'], ['#iqEm', TX.isEmail], ['#iqSize', v => +v >= 33]])) return;
    const b = e.currentTarget; TX.busy([b], 'Wird gesendet'); $('#iqError').textContent = '';
    const size = parseInt($('#iqSize').value, 10);
    try {
      const { ok } = await TX.api.inquiry({
        name: $('#iqName').value.trim(), email: $('#iqEm').value.trim(), phone: $('#iqPh').value.trim() || null,
        groupSize: size, eventType: $('#iqType').value || null, desiredDate: $('#iqDate').value || null, message: $('#iqMsg').value.trim() || null,
      });
      if (!ok) throw new Error();
      $('#inqForm').hidden = true; $('#inqDone').hidden = false;
      TX.track.inquiry(size, $('#iqType').value);
    } catch (err) {
      $('#iqError').textContent = 'Das hat nicht geklappt. Bitte schreibt uns direkt an games@turmx.de.';
    } finally { TX.unbusy([b]); }
  });

  // ── Termine abstimmen (nur Text zum Teilen, keine Buchung) ──
  const DOODLE = new Set();
  TX.onSheetOpen('doodle', renderDoodle);
  function renderDoodle() {
    const days = []; const d = TX.minDate();
    for (let i = 0; days.length < 14 && i < 60; i++) {
      const ds = TX.isoDate(d);
      // Bekannte Verfügbarkeit (aktueller Kalendermonat) berücksichtigen, sonst alle Tage
      const sameMonth = S.availMonth === `${d.getFullYear()}-${d.getMonth()}`;
      if (!sameMonth || S.availDates.size === 0 || S.availDates.has(ds)) days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    $('#doodleList').innerHTML = days.map(day => {
      const key = TX.isoDate(day);
      return `<div class="doodle-day"><div class="dd">${TX.fmtDateLong(day)} <span class="small num">${P.ppForDay(S.event || 'jga', day.getDay())} € p. P.</span></div>
        <div class="times">${cfg.SLOT_TIMES.map(t => `<button type="button" data-k="${key}_${t}" aria-pressed="${DOODLE.has(key + '_' + t)}">${t}</button>`).join('')}</div></div>`;
    }).join('');
    $$('#doodleList [data-k]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k; DOODLE.has(k) ? DOODLE.delete(k) : DOODLE.add(k);
      b.setAttribute('aria-pressed', String(DOODLE.has(k))); doodleFoot();
    }));
    doodleFoot();
  }
  function doodleText() {
    const byDay = {};
    Array.from(DOODLE).sort().forEach(k => { const [d, t] = k.split('_'); (byDay[d] = byDay[d] || []).push(t); });
    let txt = 'TurmX Games: Welcher Termin passt euch?\n\n';
    Object.keys(byDay).forEach(d => { const [y, m, dd] = d.split('-').map(Number); txt += `${TX.fmtDateLong(new Date(y, m - 1, dd))}: ${byDay[d].join(', ')} Uhr\n`; });
    return txt + '\nBuchen: https://booking.turmxgames.de';
  }
  function doodleFoot() {
    const n = DOODLE.size;
    $('#doodleCount').textContent = n ? `${n} Termin${n > 1 ? 'e' : ''} gewählt` : 'Noch keine Termine gewählt';
    const wa = $('#doodleWa'); wa.href = n ? 'https://wa.me/?text=' + encodeURIComponent(doodleText()) : '#';
    wa.setAttribute('aria-disabled', String(!n)); wa.style.opacity = n ? '' : '.5'; wa.style.pointerEvents = n ? '' : 'none';
  }
  $('#doodleCopy').addEventListener('click', e => {
    if (!DOODLE.size || !navigator.clipboard) return;
    const b = e.currentTarget;
    navigator.clipboard.writeText(doodleText()).then(() => { b.innerHTML = '<i class="ph ph-check"></i>Kopiert'; setTimeout(() => { b.innerHTML = '<i class="ph ph-copy"></i>Text kopieren'; }, 1800); }).catch(() => {});
  });

  // ── Freefall direkt aus der Detailansicht hinzufügen ──
  $('#ffAdd').addEventListener('click', () => {
    if (!S.extras.freefall) TX.setExtra('freefall', true, 'freefall_mutprobe', P.FREEFALL);
    TX.closeSheet($('#sheet-freefall')); TX.renderExtras();
  });

  // ── Preisübersicht (Leiste unten antippen) ──
  TX.onSheetOpen('price', () => { const q = TX.quote(); $('#priceSheetBody').innerHTML = q ? TX.priceRowsHtml(q) : ''; });

  // ── Cookie-Einstellungen (Usercentrics, wird über GTM geladen) ──
  $('#cookieBtn').addEventListener('click', () => { if (window.UC_UI) window.UC_UI.showSecondLayer(); });
})();
