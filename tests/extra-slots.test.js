// Testlauf Zwischen-Slots: 4. Ressource nur Fr/Sa/So 11:30/14:30/17:30 an vier Wochenenden,
// nur mit BOOKLA_EXTRA_RESOURCE_ID. Normale Buchungen dürfen nie auf der 4. Ressource landen.
const X = require('../api/_lib/extra-slots');

const R1 = '8638cf4f-12f7-4e32-bddb-39384bd6f56d', R2 = '6fbb6c14-bc34-4779-ba39-d588e0146014', R3 = '3fff2cbd-bac1-409c-adff-491526586916';
const R4 = 'r4-zwischen';
const BASE = [R1, R2, R3];

describe('Regeln', () => {
  const on = { BOOKLA_EXTRA_RESOURCE_ID: R4 };

  test('ohne Env-Variable: Standard-ID (Slot 4); "off" schaltet ab', () => {
    expect(X.resourcesFor(BASE, '2026-11-21', {})).toEqual([...BASE, X.DEFAULT_ID]);
    expect(X.resourcesFor(BASE, '2026-11-21', { BOOKLA_EXTRA_RESOURCE_ID: 'off' })).toEqual(BASE);
    expect(X.allowedTime(X.DEFAULT_ID, '10:00', {})).toBe(false);
    expect(X.allowedTime(X.DEFAULT_ID, '10:00', { BOOKLA_EXTRA_RESOURCE_ID: 'off' })).toBe(true);   // aus = nichts zu filtern
  });

  test.each([
    ['2026-11-20', true],  // Fr
    ['2026-11-21', true],  // Sa
    ['2026-11-22', true],  // So
    ['2026-11-23', false], // Mo
    ['2026-11-26', false], // Do
    ['2026-12-13', true],  // letzter Tag (So)
    ['2026-12-18', false], // nach dem Testlauf
    ['2026-11-15', false], // davor (So)
  ])('%s → aktiv %s', (date, active) => {
    expect(X.resourcesFor(BASE, date, on).includes(R4)).toBe(active);
  });

  test('4. Ressource nur zu den Zwischen-Zeiten, normale Ressourcen unverändert', () => {
    expect(['11:30', '14:30', '17:30'].every(t => X.allowedTime(R4, t, on))).toBe(true);
    expect(['10:00', '13:00', '16:00', '19:00', '12:30'].some(t => X.allowedTime(R4, t, on))).toBe(false);
    expect(X.allowedTime(R1, '13:00', on)).toBe(true);
  });

  test('UTC-Zeiten von Bookla → deutsche Uhrzeit (Winterzeit)', () => {
    expect(X.berlinTime('2026-11-21T10:30:00Z')).toBe('11:30');
    expect(X.allowedSlot(R4, '2026-11-21T10:30:00Z', on)).toBe(true);
    expect(X.allowedSlot(R4, '2026-11-21T09:00:00Z', on)).toBe(false);   // 10:00 auf der 4. Ressource: ignoriert
  });
});

// ── Über die echte Buchungsfunktion ──
const mockStore = new Map();
jest.mock('@upstash/redis', () => ({
  Redis: class {
    async set(k, v, o = {}) { if (o.nx && mockStore.has(k)) return null; mockStore.set(k, v); return 'OK'; }
    async get(k) { return mockStore.has(k) ? mockStore.get(k) : null; }
    async del(k) { mockStore.delete(k); }
    async lpush() { return 1; } async ltrim() { return 'OK'; } async hincrby() { return 1; }
  },
}));
const handler = require('../api/bookla');
const SERVICE = '8bd533a6-a6a2-4abb-b170-134b6aab74ce';

// Jede Ressource bietet hier 10:00 an (UTC 09:00), die 4. zusätzlich 11:30 (UTC 10:30) – alles frei
let queried, booked;
const slot = st => ({ startTime: st, spotsAvailable: 45, totalSpots: 45 });
beforeEach(() => {
  mockStore.clear(); queried = []; booked = [];
  Object.assign(process.env, { BOOKLA_API_KEY: 'k', BOOKLA_COMPANY_ID: 'c', BOOKLA_EXTRA_RESOURCE_ID: R4 });
  global.fetch = jest.fn(async (url, opts = {}) => {
    const ok = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/times')) {
      const rid = JSON.parse(opts.body).resourceIDs[0]; queried.push(rid);
      const day = JSON.parse(opts.body).from.slice(0, 10);
      const list = [slot(`${day}T09:00:00Z`)].concat(rid === R4 ? [slot(`${day}T10:30:00Z`)] : []);
      return ok({ times: { [rid]: list } });
    }
    if (url.endsWith('/client/bookings')) { const b = JSON.parse(opts.body); booked.push(b.resourceID); return ok({ id: 'bk' + booked.length }); }
    if (url.includes('/plugins/promocodes/list')) return ok([]);
    throw new Error('unerwartet: ' + url);
  });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { delete process.env.BOOKLA_EXTRA_RESOURCE_ID; jest.restoreAllMocks(); });

const call = async (action, body) => {
  const res = { code: 0, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(x) { this.body = x; return this; }, end() { return this; } };
  await handler({ method: 'POST', query: { action }, body }, res);
  return res;
};
const times = r => r.body.map(s => X.berlinTime(s.startAt) + ' frei:' + s.freeSlots);

test('Samstag im Testlauf: 10:00 wie immer (3 frei), dazu 11:30 von der 4. Ressource (1 frei)', async () => {
  const r = await call('available-times', { serviceId: SERVICE, date: '2026-11-21', groupSize: 8 });
  expect(times(r)).toEqual(['10:00 frei:3', '11:30 frei:1']);
  expect(queried).toContain(R4);
});

test('Montag im Testlauf: 4. Ressource wird gar nicht gefragt', async () => {
  const r = await call('available-times', { serviceId: SERVICE, date: '2026-11-23', groupSize: 8 });
  expect(times(r)).toEqual(['10:00 frei:3']);
  expect(queried).not.toContain(R4);
});

test('Abgeschaltet (BOOKLA_EXTRA_RESOURCE_ID=off): alles wie bisher', async () => {
  process.env.BOOKLA_EXTRA_RESOURCE_ID = 'off';
  const r = await call('available-times', { serviceId: SERVICE, date: '2026-11-21', groupSize: 8 });
  expect(times(r)).toEqual(['10:00 frei:3']);
});

const booking = (time, o = {}) => ({ serviceId: SERVICE, date: '2026-11-21', time, groupSize: 8, firstName: 'Lena', email: `lena+${time}@example.com`, notes: 'x', ...o });

test('Buchung 11:30 am Samstag landet auf der 4. Ressource', async () => {
  const r = await call('create-booking', booking('11:30'));
  expect(r.code).toBe(201);
  expect(booked).toEqual([R4]);
});

test('Buchung 10:00 landet nie auf der 4. Ressource (auch wenn die frei wäre)', async () => {
  const r = await call('create-booking', booking('10:00'));
  expect(r.code).toBe(201);
  expect(booked[0]).not.toBe(R4);
  expect(queried).not.toContain(R4);
});

test('11:30 an einem Montag: nicht buchbar', async () => {
  const r = await call('create-booking', booking('11:30', { date: '2026-11-23' }));
  expect(r.code).toBe(409);
  expect(booked).toEqual([]);
});
