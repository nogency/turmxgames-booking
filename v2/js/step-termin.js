/**
 * Schritt 2 – Termin: Kalender (Bookla available-dates) + Uhrzeiten (Bookla available-times).
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;
  const cal = { y: 0, m: 0 };
  let timesReq = 0;

  TX.renderDayHint = () => {
    const txt = {
      jga: 'Montag bis Donnerstag nur 28 € statt 35 € pro Person.',
      friends: 'Montag bis Donnerstag nur 28 € statt 35 € pro Person.',
      kinder: 'Montag bis Freitag 24 €, am Wochenende 30 € pro Kind.',
      firma: TX.isXmas() ? 'Weihnachtsfeier geplant? Termine im Dezember am besten früh sichern.' : '',
    }[S.event];
    const h = $('#dayHint'); h.hidden = !txt;
    h.innerHTML = txt ? `<i class="ph ${S.event === 'firma' ? 'ph-tree-evergreen' : 'ph-tag'}"></i><span>${txt}</span>` : '';
  };

  TX.initCalendar = () => {
    const d = S.date || TX.minDate();
    cal.y = d.getFullYear(); cal.m = d.getMonth();
  };

  TX.renderCal = async () => {
    const { y, m } = cal;
    $('#calTitle').textContent = `${TX.MONTHS[m]} ${y}`;
    const key = `${y}-${m}`;
    if (S.availMonth !== key) {
      // Platzhalter, solange Bookla antwortet
      $('#calGrid').innerHTML = dow() + '<div class="skel" style="grid-column:1/-1;height:250px"></div>';
      S.availDates = await TX.api.availableDates(y, m + 1);
      S.availMonth = key;
      if (`${cal.y}-${cal.m}` !== key) return;   // inzwischen weitergeblättert
    }
    const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    const today = TX.today(), minD = TX.minDate();
    let html = dow();
    for (let i = 0; i < offset; i++) html += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const dt = new Date(y, m, d), ds = TX.isoDate(dt);
      const tooEarly = dt < minD;
      // Leere Liste von Bookla = alle Tage anzeigen (Verhalten wie v1)
      const full = !tooEarly && S.availDates.size > 0 && !S.availDates.has(ds);
      const sel = S.dateStr === ds;
      const pp = S.override ? S.override.pp : P.ppForDay(S.event, dt.getDay());
      const label = `${TX.fmtDateLong(dt)}, ${tooEarly ? 'nicht buchbar' : full ? 'ausgebucht' : pp + ' Euro pro Person'}`;
      html += `<button type="button" class="day${full ? ' full' : ''}${dt.getTime() === today.getTime() ? ' today' : ''}" data-d="${d}" aria-pressed="${sel}" aria-label="${label}" ${tooEarly || full ? 'disabled' : ''}>
        <span class="d num">${d}</span><span class="p num">${tooEarly ? '&nbsp;' : full ? 'voll' : pp + ' €'}</span></button>`;
    }
    $('#calGrid').innerHTML = html;
    $('#calPrev').disabled = new Date(y, m, 1) <= new Date(minD.getFullYear(), minD.getMonth(), 1);
    $('#calNext').disabled = (y - today.getFullYear()) * 12 + (m - today.getMonth()) >= 11;
    $$('#calGrid .day:not(:disabled)').forEach(b => b.addEventListener('click', () => TX.pickDate(new Date(y, m, +b.dataset.d))));
  };
  const dow = () => ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="cal-dow" aria-hidden="true">${d}</div>`).join('');

  TX.pickDate = dt => {
    S.date = dt; S.dateStr = TX.isoDate(dt); S.time = null;
    TX.resetPromo();   // wie v1: neuer Termin → Code neu prüfen
    $('#err-2d').classList.remove('show');
    TX.track.date();
    TX.renderCal(); TX.changed();
    const block = $('#slotBlock'); block.hidden = false;
    $('#slotTitle').textContent = `Uhrzeit am ${TX.fmtDateLong(dt)}`;
    TX.loadSlots();
    setTimeout(() => block.scrollIntoView({ behavior: TX.reduceMotion ? 'auto' : 'smooth', block: 'start' }), 60);
  };

  TX.loadSlots = async () => {
    if (!S.dateStr) return;
    const req = ++timesReq;
    $('#slots').innerHTML = '<div class="skel"></div>'.repeat(4);   // Skeleton statt Spinner
    try {
      const times = await TX.api.availableTimes(S.dateStr, S.qty);
      if (req !== timesReq) return;
      renderSlots(times);
    } catch (e) {
      if (req !== timesReq) return;
      // Bewusst KEINE Ersatz-Uhrzeiten (v1 tat das → Buchung auf nicht existierende Slots möglich)
      $('#slots').innerHTML = `<p class="slot-error">Die Uhrzeiten konnten gerade nicht geladen werden. <button class="link" type="button" id="slotRetry">Erneut laden</button> oder ruft uns an: <a class="link" href="tel:${TX.config.PHONE_TEL}">${TX.config.PHONE}</a></p>`;
      $('#slotRetry').addEventListener('click', TX.loadSlots);
    }
  };

  function renderSlots(times) {
    if (!times.length) { $('#slots').innerHTML = '<p class="slot-error">An diesem Tag sind leider keine Zeiten frei.</p>'; return; }
    $('#slots').innerHTML = times.map(slot => {
      const t = slot.startAt
        ? new Date(slot.startAt).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
        : slot.time;
      const full = slot.available === false || slot.spots === 0;
      const last = !full && slot.freeSlots === 1;
      const st = full ? 'Ausgebucht' : last ? 'Letzter freier Raum' : 'Frei';
      return `<button type="button" class="slot" data-t="${t}" aria-pressed="${S.time === t}" ${full ? 'disabled' : ''} aria-label="${t} Uhr, ${st}">
        <span class="t num">${t}</span><span class="s${last ? ' last' : ''}">${st}</span></button>`;
    }).join('');
    $$('#slots .slot:not(:disabled)').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.t;
      S.time = t;
      TX.resetPromo();
      $('#err-2t').classList.remove('show');
      $$('#slots .slot').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.t === t)));
      TX.track.time();
      TX.changed();
      // Hier dockt später die echte Reservierung an (Bookla "pending"), vorerst ohne Countdown.
      setTimeout(() => { if (S.step === 2 && S.time === t) TX.go(3); }, TX.reduceMotion ? 0 : 350);
    }));
  }

  $('#calPrev').addEventListener('click', () => { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } TX.renderCal(); });
  $('#calNext').addEventListener('click', () => { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } TX.renderCal(); });
})();
