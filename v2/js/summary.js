/**
 * Zusammenfassung, Preisaufstellung, Rabatt-/Gutscheincode, Stornohinweis.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;

  const LABEL = {
    base: () => 'Grundgebühr',
    persons: l => `${l.qty} × ${TX.eurShort(l.unit)} ${S.event === 'kinder' ? 'pro Kind' : 'pro Person'}`,
    drinks: l => `Getränkeflat, ${l.qty} × ${TX.eur(l.unit)}`,
    insurance: () => 'Flex-Versicherung',
    freefall: () => 'Freefall-Mutprobe',
  };

  TX.priceRowsHtml = q => q.lines.map(l => `<div class="pr"><span>${LABEL[l.key](l)}</span><span class="num">${TX.eur(l.amount)}</span></div>`).join('')
    + (q.discount ? `<div class="pr discount"><span>Rabatt (${TX.esc(S.promo.code)})</span><span class="num">- ${TX.eur(q.discount)}</span></div>` : '')
    + `<div class="pr total"><span>Gesamt</span><b class="num">${TX.eur(q.total)}</b></div>`
    + `<div class="vat"><span>darin 19 % MwSt.</span><span class="num">${TX.eur(q.vat)}</span></div>`;

  TX.summaryHtml = withEdit => {
    const q = TX.quote(); if (!q) return '<p class="small" style="margin:0">Noch nichts ausgewählt.</p>';
    const edit = withEdit && !S.fc;   // Admin-Link: vorbereitete Angaben sind gesperrt
    const ex = [S.extras.drinks && 'Getränkeflat', S.extras.insurance && 'Flex-Versicherung', S.extras.freefall && S.event === 'jga' && 'Freefall-Mutprobe'].filter(Boolean);
    const row = (k, v, step) => `<div class="sum-row"><div><div class="sum-k">${k}</div><div class="sum-v">${v}</div></div>${edit && step ? `<button class="link" type="button" data-go="${step}">Ändern</button>` : ''}</div>`;
    const c = TX.contact();
    const contact = S.detailsOk ? [`${c.firstName} ${c.lastName}`.trim(), c.email, c.companyName].filter(Boolean).map(TX.esc).join('<br>') : '';
    return `<div class="sum-rows">
        ${row('Event', TX.esc(TX.eventName()) + (S.age ? `, ${S.age} Jahre` : ''), 1)}
        ${row('Termin', S.date ? `${TX.fmtDateShort(S.date)} ${S.time ? 'um ' + S.time + ' Uhr' : ''}` : 'noch offen', 2)}
        ${row(S.event === 'kinder' ? 'Kinder' : 'Personen', S.qtySeen ? String(S.qty) : 'noch offen', 3)}
        ${ex.length ? row('Extras', ex.join(', '), 3) : ''}
        ${contact ? row('Kontakt', contact, 4) : ''}
      </div>
      ${S.qtySeen ? `<div class="price-rows">${TX.priceRowsHtml(q)}</div>` : ''}`;
  };

  TX.renderSummary = () => {
    $('#summaryBody').innerHTML = TX.summaryHtml(true);
    $$('#summaryBody [data-go]').forEach(b => b.addEventListener('click', () => TX.go(+b.dataset.go)));
    TX.syncPromo($('#summaryPromo'), !S.fc);   // Admin-Link: Preise sind festgelegt, kein Code
    $('#stornoLine').textContent = TX.stornoText();
  };

  // ── Rabatt-/Gutscheincode (Bookla validate-code; Betrag immer live aus der Definition) ──
  const defFrom = d => ({ discountType: d.discountType, discountValue: d.discountValue, maxDiscountCents: d.maxDiscountCents });
  TX.resetPromo = () => { S.promo = { code: null, def: null }; };

  /**
   * Codefeld. Steht in der Seitenleiste (Desktop), in der Preisübersicht (mobil) und in der Zusammenfassung.
   * Neu gezeichnet wird nur, wenn sich der Code-Status ändert – sonst ginge eine angefangene Eingabe verloren.
   */
  TX.syncPromo = (box, show) => {
    const key = show ? 'on:' + (S.promo.code || '') : 'off';
    if (box.dataset.k === key) return;
    box.dataset.k = key; box.hidden = !show;
    if (!show) { box.innerHTML = ''; return; }
    if (S.promo.code) {
      box.innerHTML = `<p class="promo-on"><i class="ph ph-tag"></i><span>Code <b>${TX.esc(S.promo.code)}</b> eingelöst</span><button class="link" type="button">Entfernen</button></p>`;
      box.querySelector('button').addEventListener('click', () => { TX.resetPromo(); TX.changed(); });
      return;
    }
    box.innerHTML = `<label class="promo-lbl" for="${box.id}In">Gutschein oder Rabattcode</label>
      <div class="promo-row"><input class="input" id="${box.id}In" maxlength="30" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="Code eingeben"><button class="btn btn-secondary" type="button">Einlösen</button></div>
      <p class="field-msg" role="alert"></p>`;
    const input = box.querySelector('input'), btn = box.querySelector('button'), msg = box.querySelector('.field-msg');
    btn.addEventListener('click', () => applyPromo(input, btn, msg));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') applyPromo(input, btn, msg); });
    input.addEventListener('input', () => { msg.textContent = ''; });
  };

  async function applyPromo(input, btn, msg) {
    const code = input.value.trim().toUpperCase(); if (!code || btn.getAttribute('aria-busy') === 'true') return;
    msg.textContent = '';
    if (!S.dateStr || !S.time) { msg.textContent = 'Bitte zuerst Datum und Uhrzeit wählen.'; return; }
    TX.busy([btn], '');
    try {
      const { ok, data } = await TX.api.validateCode(code);
      if (!ok || !data.canApply) { msg.textContent = 'Dieser Code ist ungültig oder hier nicht anwendbar.'; return; }
      const def = defFrom(data);
      const q = TX.quote();
      if (P.promoDiscount(def, q.baseOnly) <= 0) { msg.textContent = 'Für diesen Termin ergibt der Code keinen Rabatt.'; return; }
      S.promo = { code, def };
      TX.changed();
    } catch (e) {
      msg.textContent = 'Der Code konnte gerade nicht geprüft werden. Bitte erneut versuchen.';
    } finally {
      if (document.body.contains(btn)) TX.unbusy([btn]);
    }
  }

  /** Nach Änderung der Personenzahl: lehnt Bookla den Code ab (4xx/canApply=false) → entfernen; bei 5xx behalten. */
  TX.revalidatePromo = () => {
    if (!S.promo.code || !S.dateStr || !S.time) return;
    const code = S.promo.code, qty = S.qty;
    TX.api.validateCode(code).then(({ ok, status, data }) => {
      if (S.promo.code !== code || S.qty !== qty) return;   // inzwischen geändert → neuere Prüfung zählt
      if ((ok && !data.canApply) || (status >= 400 && status < 500)) { TX.resetPromo(); TX.changed(); }
      else if (ok && data.canApply) { S.promo.def = defFrom(data); TX.changed(); }
    }).catch(() => {});
  };

  // Stornofrist laut AGB: bis 14 Tage vorher kostenlos. Kurzfristige Termine ehrlich kennzeichnen.
  TX.stornoText = () => {
    if (!S.date) return 'Kostenlos stornierbar bis 14 Tage vor dem Termin.';
    const dl = new Date(S.date); dl.setDate(dl.getDate() - 14);
    return dl >= TX.today()
      ? `Kostenlos stornierbar bis ${dl.getDate()}. ${TX.MONTHS[dl.getMonth()]}.`
      : 'Der Termin ist in weniger als 14 Tagen. Eine Stornierung ist deshalb nur gegen Gebühr möglich (siehe AGB).';
  };
})();
