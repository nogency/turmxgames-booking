/**
 * TurmX Buchung v2 – gemeinsame UI-Bausteine: Sheets, Formularprüfung, Ladezustand.
 */
(function () {
  'use strict';
  const TX = window.TX, $ = TX.$, $$ = TX.$$;

  // ── Sheets (Dialoge von unten bzw. mittig am Desktop) ──
  let lastFocus = null;
  const openers = {};   // id → Funktion, die vor dem Öffnen läuft
  TX.onSheetOpen = (id, fn) => { openers[id] = fn; };
  TX.openSheet = id => {
    const s = $(`#sheet-${id}`); if (!s) return;
    lastFocus = document.activeElement;
    if (openers[id]) openers[id]();
    s.classList.add('open'); document.body.style.overflow = 'hidden';
    const c = s.querySelector('.panel-head [data-close]'); if (c) c.focus();
  };
  TX.closeSheet = s => {
    s.classList.remove('open');
    if (!$('.sheet.open')) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  };
  TX.bindSheetButtons = root => {
    root.querySelectorAll('[data-sheet]').forEach(b => {
      if (b.dataset.bound) return; b.dataset.bound = '1';
      b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); TX.openSheet(b.dataset.sheet); });
    });
  };
  document.addEventListener('click', e => {
    const c = e.target.closest('.sheet [data-close]');
    if (c) TX.closeSheet(c.closest('.sheet'));
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $$('.sheet.open').forEach(TX.closeSheet); });

  // ── Formularprüfung: Fehler direkt unter dem Feld, Fokus aufs erste fehlerhafte ──
  // silent = nur prüfen, nichts markieren
  TX.validate = (rules, silent) => {
    let first = null;
    rules.forEach(([sel, test]) => {
      const el = $(sel); if (!el) return;
      const v = el.value.trim();
      const ok = test ? test(v) : !!v;
      if (!silent) { el.setAttribute('aria-invalid', String(!ok)); el.closest('.field').classList.toggle('invalid', !ok); }
      if (!ok && !first) first = el;
    });
    if (first && !silent) { first.focus(); first.scrollIntoView({ behavior: TX.reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
    return !first;
  };
  TX.isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  TX.isPhone = v => (v.match(/\d/g) || []).length >= 6;
  // Fehler verschwinden beim Verlassen des Feldes, sobald es befüllt ist
  document.addEventListener('focusout', e => {
    const el = e.target;
    if (el.classList && el.classList.contains('input') && el.getAttribute('aria-invalid') === 'true' && el.value.trim()) {
      el.setAttribute('aria-invalid', 'false'); const f = el.closest('.field'); if (f) f.classList.remove('invalid');
    }
  });

  // ── Ladezustand an Buttons ──
  TX.busy = (btns, label) => btns.forEach(b => { b.dataset.label = b.dataset.label || b.innerHTML; b.setAttribute('aria-busy', 'true'); b.innerHTML = `<span class="spin"></span> ${label}`; });
  TX.unbusy = btns => btns.forEach(b => { b.removeAttribute('aria-busy'); if (b.dataset.label) b.innerHTML = b.dataset.label; delete b.dataset.label; });

  // ── Saison Weihnachtsfeier: 1.10. bis 22.12. (Vorschau mit ?xmas=1 / ?xmas=0) ──
  TX.isXmas = () => {
    const p = new URLSearchParams(location.search).get('xmas');
    if (p === '1') return true; if (p === '0') return false;
    const t = new Date(), m = t.getMonth(), d = t.getDate();
    return m === 9 || m === 10 || (m === 11 && d <= 22);
  };
  TX.garlandHtml = (n = 9) => {
    const seg = 100 / n; let d = 'M0,3';
    for (let i = 0; i < n; i++) d += ` Q${(i + .5) * seg},13 ${(i + 1) * seg},3`;
    const colors = ['#e0463a', '#f2c14e', '#fff1cc', '#3f9e5a'];
    const bulbs = Array.from({ length: n }, (_, i) => `<span class="bulb" style="left:${(i + .5) * seg}%;--c:${colors[i % colors.length]};--d:${((i * .47) % 2).toFixed(2)}s"></span>`).join('');
    return `<span class="garland" aria-hidden="true"><svg viewBox="0 0 100 16" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>${bulbs}</span>`;
  };
})();
