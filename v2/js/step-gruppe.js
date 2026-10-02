/**
 * Schritt 3 – Personenzahl, Alter (Kindergeburtstag), Extras.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;

  TX.setQty = n => {
    S.qty = Math.max(P.MIN_QTY, Math.min(P.MAX_QTY, n));
    TX.renderQty(); TX.renderExtras(); TX.changed();
    TX.revalidatePromo();   // Code ggf. für neue Personenzahl prüfen (Logik aus v1-Fix fc6b3f1)
  };

  TX.renderQty = () => {
    $('#qtyVal').textContent = S.qty;
    $('#qtyUnit').textContent = S.event === 'kinder' ? 'Kinder' : 'Personen';
    $('#qtyMinus').disabled = S.qty <= P.MIN_QTY; $('#qtyPlus').disabled = S.qty >= P.MAX_QTY;
    // Mindestanzahl immer sichtbar; am Minimum hervorgehoben (erklärt das ausgegraute Minus)
    $('#qtyMin').textContent = `mindestens ${P.MIN_QTY}`;
    $('#qtyMin').classList.toggle('at', S.qty <= P.MIN_QTY);
    $('#qtyMinus').setAttribute('aria-label', S.qty <= P.MIN_QTY ? `Mindestens ${P.MIN_QTY} ${S.event === 'kinder' ? 'Kinder' : 'Personen'}` : 'Eine Person weniger');
    const teams = Math.ceil(S.qty / 16), per = Math.ceil(S.qty / teams);
    $('#qtyTeams').textContent = teams === 1 ? 'Ihr spielt in einem Team.' : `Ihr spielt in ${teams} Teams mit je bis zu ${per} Personen.`;
    $('#quick').innerHTML = [6, 8, 10, 12, 16, 20, 24, 32].map(n => `<button type="button" aria-pressed="${S.qty === n}" data-n="${n}">${n}</button>`).join('');
    $$('#quick button').forEach(b => b.addEventListener('click', () => TX.setQty(+b.dataset.n)));
    $('#ageBlock').hidden = S.event !== 'kinder';
    $('#ages').innerHTML = ['8', '9', '10', '11', '12', '13', '14', '15+'].map(a => `<button type="button" aria-pressed="${S.age === a}" data-a="${a}">${a}</button>`).join('');
    $$('#ages button').forEach(b => b.addEventListener('click', () => { S.age = b.dataset.a; TX.renderQty(); TX.changed(); }));
  };

  TX.renderExtras = () => {
    const dp = P.drinksPrice(S.event);
    // Kein Bier-Icon bei Kindern und Schulgruppen
    const drinksIcon = { kinder: 'ph-orange-slice', schule: 'ph-pint-glass', verein: 'ph-pint-glass' }[S.event] || 'ph-beer-stein';
    const items = [
      { k: 'drinks', icon: drinksIcon, track: 'getraenkeflat', name: 'Getränkeflat', meta: S.event === 'kinder' ? 'Softdrinks und Wasser, so viel ihr wollt' : 'So viel ihr wollt, ab 18 auch Bier', price: `${S.qty} × ${TX.eur(dp)} = ${TX.eur(P.round2(dp * S.qty))}`, value: () => dp * S.qty },
      { k: 'insurance', icon: 'ph-shield-check', track: 'versicherung', name: 'Flex-Versicherung', meta: 'Personenzahl bis kurz vorher anpassen', price: '14,90 € einmalig', value: () => P.INSURANCE },
    ];
    if (S.event === 'jga') items.push({ k: 'freefall', icon: 'ph-arrow-fat-lines-down', track: 'freefall_mutprobe', name: 'Freefall-Mutprobe', meta: 'Blind vom Turm, für Braut oder Bräutigam', price: '30 € einmalig', value: () => P.FREEFALL, more: true });
    $('#extras').innerHTML = items.map(x => `<label class="extra">
        <span class="opt-ico" aria-hidden="true"><i class="ph ${x.icon}"></i></span>
        <span><span class="extra-name">${x.name}</span><span class="extra-meta">${x.meta}</span><span class="extra-price num">${x.price}</span>
        ${x.more ? '<button class="link" type="button" data-sheet="freefall">Mehr erfahren</button>' : ''}</span>
        <span class="switch"><input type="checkbox" role="switch" data-x="${x.k}" ${S.extras[x.k] ? 'checked' : ''} aria-label="${x.name}"><span></span></span>
      </label>`).join('');
    $$('#extras input').forEach(i => i.addEventListener('change', () => {
      const x = items.find(it => it.k === i.dataset.x);
      TX.setExtra(x.k, i.checked, x.track, x.value());
    }));
    TX.bindSheetButtons($('#extras'));
  };

  TX.setExtra = (k, on, trackName, price) => {
    S.extras[k] = on;
    TX.track.extra(trackName, on, price);
    TX.changed();
  };

  $('#qtyMinus').addEventListener('click', () => TX.setQty(S.qty - 1));
  $('#qtyPlus').addEventListener('click', () => TX.setQty(S.qty + 1));
})();
