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
    $('#summaryCard').innerHTML = TX.summaryHtml(true) + (S.fc ? '' : `
      <div class="promo">
        ${S.promo.code ? `<p class="small" style="margin:10px 0 0">Code ${TX.esc(S.promo.code)} ist aktiv. <button class="link" type="button" id="promoRemove">Entfernen</button></p>`
        : `<button class="link" type="button" id="promoToggle">Gutschein oder Rabattcode eingeben</button>
           <div id="promoBox" hidden><div class="promo-row"><input class="input" id="promoInput" maxlength="30" autocapitalize="characters" aria-label="Gutschein- oder Rabattcode"><button class="btn btn-secondary" type="button" id="promoApply">Einlösen</button></div>
           <p class="field-msg" id="promoMsg" role="alert"></p></div>`}
      </div>`);
    $$('#summaryCard [data-go]').forEach(b => b.addEventListener('click', () => TX.go(+b.dataset.go)));
    const t = $('#promoToggle'); if (t) t.addEventListener('click', () => { $('#promoBox').hidden = false; t.hidden = true; $('#promoInput').focus(); });
    const a = $('#promoApply'); if (a) a.addEventListener('click', applyPromo);
    const i = $('#promoInput'); if (i) i.addEventListener('keydown', e => { if (e.key === 'Enter') applyPromo(); });
    const r = $('#promoRemove'); if (r) r.addEventListener('click', () => { TX.resetPromo(); TX.changed(); });
    $('#stornoLine').textContent = TX.stornoText();
  };

  // ── Rabatt-/Gutscheincode (Bookla validate-code; Betrag immer live aus der Definition) ──
  const defFrom = d => ({ discountType: d.discountType, discountValue: d.discountValue, maxDiscountCents: d.maxDiscountCents });
  TX.resetPromo = () => { S.promo = { code: null, def: null }; };

  async function applyPromo() {
    const code = $('#promoInput').value.trim().toUpperCase(); if (!code) return;
    const btn = $('#promoApply'), msg = $('#promoMsg');
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
