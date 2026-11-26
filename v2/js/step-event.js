/**
 * Schritt 1 – Eventart wählen.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;

  // Karten: Schule und Verein teilen sich eine Karte (Auswahl in Schritt 4)
  const CARDS = [
    { key: 'jga', name: 'JGA', meta: 'Junggesellenabschied, 2,5 Std.', icon: 'ph-champagne' },
    { key: 'firma', name: 'Firmen & Teams', meta: 'Teamevent, 2,5 Std.', icon: 'ph-buildings' },
    { key: 'friends', name: 'Freunde & Familie', meta: 'Geburtstag oder Treffen, 2,5 Std.', icon: 'ph-users-three' },
    { key: 'kinder', name: 'Kindergeburtstag', meta: 'Ab 8 Jahren, 2,5 Std.', icon: 'ph-cake', unit: 'pro Kind' },
    { key: 'schule', name: 'Schule oder Verein', meta: 'Sonderpreis mit Nachweis, 2,5 Std.', icon: 'ph-graduation-cap' },
  ];
  TX.cardFor = ev => CARDS.find(c => c.key === (P.isSocial(ev) ? 'schule' : ev));

  // Saison-Hervorhebung (Lichterkette + Hinweis), Zeiträume in TX.season (ui.js)
  const SEASON = {
    firma: { key: 'firma', tag: 'Ideal für eure Weihnachtsfeier', icon: 'ph-tree-evergreen' },
    between: { key: 'friends', tag: 'Perfekt für zwischen den Tagen', icon: 'ph-sparkle' },
  };

  TX.renderEvents = () => {
    const season = SEASON[TX.season()];
    $('#eventOpts').innerHTML = CARDS.map(c => {
      const fixed = c.key === 'firma' || c.key === 'schule';
      const base = P.EVENTS[c.key].base;
      const isX = !!season && c.key === season.key;
      const checked = S.event && TX.cardFor(S.event).key === c.key;
      return `<label class="opt${isX ? ' xmas' : ''}">
        ${isX ? TX.garlandHtml() : ''}
        <input type="radio" name="event" value="${c.key}" ${checked ? 'checked' : ''} aria-label="${c.name}, ${fixed ? '' : 'ab '}${P.minPP(c.key)} Euro ${c.unit || 'pro Person'}${isX ? ', ' + season.tag.toLowerCase() : ''}">
        <span class="opt-ico"><i class="ph ${c.icon}"></i></span>
        <span><span class="opt-name">${c.name}</span><span class="opt-meta">${c.meta}<br>${base ? `+ ${base} € Grundgebühr` : 'Keine Grundgebühr'}</span>${isX ? `<span class="xmas-tag"><i class="ph ${season.icon}"></i>${season.tag}</span>` : ''}</span>
        <span class="opt-price"><span>${fixed ? '' : 'ab'}</span><b class="num">${P.minPP(c.key)} €</b><span>${c.unit || 'pro Person'}</span></span>
      </label>`;
    }).join('');
    $$('#eventOpts input').forEach(inp => inp.addEventListener('change', () => TX.selectEvent(inp.value, true)));
  };

  /** Eventart setzen. advance = nach Auswahl automatisch zum Termin */
  TX.selectEvent = (key, advance) => {
    // "Schule oder Verein": bisherige Wahl Verein beibehalten, sonst Schule
    S.event = key === 'schule' && S.event === 'verein' ? 'verein' : key;
    if (S.event !== 'jga') S.extras.freefall = false;
    if (S.event !== 'kinder') S.age = null;
    TX.track.eventType();
    TX.changed();
    if (advance) setTimeout(() => TX.go(2), TX.reduceMotion ? 0 : 260);
  };
})();
