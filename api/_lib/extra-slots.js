/**
 * Testlauf Zwischen-Slots (ab 19.11.2026): eine 4. Bookla-Ressource ("Booking Stream 4") bietet an den
 * nächsten vier Wochenenden zusätzliche Zeiten zwischen den normalen Slots (10/13/16/19 Uhr) an.
 *
 * - 4. Ressource "TurmXGamesSlot 4" (DEFAULT_ID). Abschalten ohne Deploy: BOOKLA_EXTRA_RESOURCE_ID=off in Vercel;
 *   eine andere ID dort ersetzt die Standard-ID.
 * - Nur Fr/Sa/So im Zeitraum EXTRA.from bis EXTRA.until (deutsche Zeit).
 * - Von dieser Ressource zählen NUR die Zeiten in EXTRA.times. Bietet Bookla sie zu anderen Zeiten an,
 *   werden die ignoriert – normale Buchungen landen nie auf der 4. Ressource.
 */
const { DateTime } = require('luxon');

const ZONE = 'Europe/Berlin';
const EXTRA = {
  times: ['11:30', '14:30', '17:30'],
  weekdays: [5, 6, 7],               // luxon: 1 = Mo … 7 = So → Fr, Sa, So
  from: '2026-11-20',
  until: '2026-12-13',               // vier Wochenenden: 20.–22.11., 27.–29.11., 4.–6.12., 11.–13.12.
};

const DEFAULT_ID = 'fbac8cf5-8ce5-40db-ac70-534853dd09e1';   // Bookla: TurmXGamesSlot 4

function extraResourceId(env = process.env) {
  const v = String(env.BOOKLA_EXTRA_RESOURCE_ID || '').trim();
  if (v.toLowerCase() === 'off') return null;
  return v || DEFAULT_ID;
}

/** Gilt der Testlauf an diesem Tag ('YYYY-MM-DD')? */
function extraActiveOn(date) {
  const d = DateTime.fromISO(String(date), { zone: ZONE });
  return d.isValid && date >= EXTRA.from && date <= EXTRA.until && EXTRA.weekdays.includes(d.weekday);
}

/** Ressourcen für einen Tag: die normalen, plus die 4. an Testtagen (wenn eingeschaltet). */
function resourcesFor(baseIds, date, env = process.env) {
  const id = extraResourceId(env);
  return id && extraActiveOn(date) && !baseIds.includes(id) ? [...baseIds, id] : baseIds;
}

const berlinTime = iso => DateTime.fromISO(String(iso), { zone: 'utc' }).setZone(ZONE).toFormat('HH:mm');

/** Darf diese Ressource zu dieser Uhrzeit ('HH:mm', deutsche Zeit) gebucht/angezeigt werden? */
function allowedTime(rid, time, env = process.env) {
  const id = extraResourceId(env);
  return !id || rid !== id || EXTRA.times.includes(time);
}

/** Wie allowedTime, für einen Bookla-Slot mit startTime in UTC. */
const allowedSlot = (rid, startTime, env = process.env) => allowedTime(rid, berlinTime(startTime), env);

module.exports = { EXTRA, DEFAULT_ID, extraResourceId, extraActiveOn, resourcesFor, allowedTime, allowedSlot, berlinTime };
