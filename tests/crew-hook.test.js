// Andockpunkt TurmX Crew: darf eine Buchung nie stören (kein Wurf, kein Link bei allem Unklaren).
const { notifyCrew } = require('../api/_lib/crew-hook');

const payload = { bookingIds: ['b1'], date: '2026-12-12', time: '16:00', groupSize: 8, eventKey: 'jga', notes: 'x', firstName: 'Lisa', email: 'lisa@example.de' };
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  process.env.CREW_HOOK_URL = 'https://crew.example/api/hook';
  process.env.CREW_HOOK_SECRET = 'geheim';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('ohne URL oder Geheimnis: kein Aufruf', async () => {
  delete process.env.CREW_HOOK_SECRET;
  const fetchFn = jest.fn();
  expect(await notifyCrew(payload, { fetchFn })).toBeNull();
  expect(fetchFn).not.toHaveBeenCalled();
});

test('Show angelegt: Gastgeber-Link, Aufruf mit Bearer und JSON', async () => {
  const fetchFn = jest.fn(reply(201, { ok: true, crew: true, created: true, guestUrl: 'https://c/s/A', hostUrl: 'https://c/h/B' }));
  expect(await notifyCrew(payload, { fetchFn })).toEqual({ hostUrl: 'https://c/h/B' });
  const [url, opts] = fetchFn.mock.calls[0];
  expect(url).toBe('https://crew.example/api/hook');
  expect(opts.headers.Authorization).toBe('Bearer geheim');
  expect(JSON.parse(opts.body)).toEqual(payload);
});

test.each([
  ['Kinder-Event (crew: false)', reply(200, { ok: true, crew: false })],
  ['Crew aus', reply(200, { ok: true, skipped: 'crew_disabled' })],
  ['Serverfehler', reply(500, { error: 'x' })],
  ['kein JSON', async () => ({ ok: true, status: 200, json: async () => { throw new Error('kein JSON'); } })],
  ['Link ohne https', reply(200, { ok: true, crew: true, hostUrl: 'javascript:alert(1)' })],
  ['Netzwerkfehler', async () => { throw new Error('ECONNREFUSED'); }],
])('%s: null, kein Wurf', async (_, fetchFn) => {
  expect(await notifyCrew(payload, { fetchFn })).toBeNull();
});

test('Zeitlimit: bricht nach timeoutMs ab', async () => {
  const fetchFn = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const t0 = Date.now();
  expect(await notifyCrew(payload, { fetchFn, timeoutMs: 100 })).toBeNull();
  expect(Date.now() - t0).toBeLessThan(1000);
});
