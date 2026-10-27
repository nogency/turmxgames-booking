/**
 * Andockpunkt TurmX Crew (Repo nogency/turmx-crew, docs/andockpunkt-buchung.md).
 *
 * Meldet eine erfolgreiche Buchung an Crew. Crew legt die Show an, schickt dem Gastgeber selbst die Mail
 * und antwortet mit dem Gastgeber-Link für die Erfolgsseite. Eine Buchung darf an Crew NIE scheitern:
 * ohne CREW_HOOK_URL/CREW_HOOK_SECRET kein Aufruf, sonst höchstens 1,5 s warten, Fehler nur protokollieren.
 * Verpasste Buchungen holt Crew beim täglichen Bookla-Abgleich selbst nach.
 */
const TIMEOUT_MS = 1500;

/** → { hostUrl } oder null. Wirft nie. */
async function notifyCrew(payload, { fetchFn = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const url = process.env.CREW_HOOK_URL;
  const secret = process.env.CREW_HOOK_SECRET;
  if (!url || !secret) return null;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.crew || typeof data.hostUrl !== 'string' || !/^https:\/\//.test(data.hostUrl)) {
      if (!res.ok) console.warn('[Crew] Andockpunkt antwortet', res.status);
      return null;
    }
    return { hostUrl: data.hostUrl };
  } catch (err) {
    console.warn('[Crew] Andockpunkt nicht erreicht:', err && err.message);
    return null;
  }
}

module.exports = { notifyCrew };
