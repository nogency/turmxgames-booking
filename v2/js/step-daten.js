/**
 * Schritt 4 – Kontaktdaten, Firma bzw. Schule/Verein, Wünsche.
 */
(function () {
  'use strict';
  const TX = window.TX, P = window.TXPricing, $ = TX.$, $$ = TX.$$, S = TX.S;

  TX.renderOrg = () => {
    const needs = TX.needsOrg(), social = P.isSocial(S.event);
    $('#orgFields').hidden = !needs;
    $('#orgLegend').textContent = social ? 'Schule oder Verein' : 'Firma';
    $('#orgTypeField').hidden = !social;
    $('#orgLabel').textContent = !social ? 'Firmenname' : S.event === 'verein' ? 'Name des Vereins' : 'Name der Schule';
    $('#vatField').hidden = social;
    $('#proofNote').hidden = !social;
    $$('[data-org]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.org === S.event)));
  };

  /** silent: nur prüfen (vor dem Bezahlen), nicht markieren */
  TX.validateDetails = silent => {
    const rules = [['#fn'], ['#ln'], ['#em', TX.isEmail], ['#ph', TX.isPhone]];
    // Pflichtfelder hängen an der Eventart, nicht daran, was gerade sichtbar ist
    if (TX.needsOrg()) rules.push(['#org'], ['#street'], ['#zip'], ['#city']);
    return TX.validate(rules, silent);
  };

  $$('[data-org]').forEach(b => b.addEventListener('click', () => {
    S.event = b.dataset.org;   // schule | verein → eigener Name in Notizen/Tracking wie v1
    TX.renderOrg(); TX.changed();
  }));
  $('#wishToggle').addEventListener('click', e => { $('#wishField').hidden = false; e.currentTarget.hidden = true; $('#wish').focus(); });
})();
