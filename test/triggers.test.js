import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StateStore } from '../src/accuweather/store.js';
import {
  SCENE_TRIGGERS,
  TriggerWatcher,
  firstWetHour,
  frostDays,
} from '../src/capabilities/triggers.js';
import {
  NOW,
  alert,
  current,
  daily,
  fakeClock,
  hourly,
  tempDataDir,
} from './helpers/fakeAccuWeather.js';

const LOCATION = { key: '623', name: 'Paris' };

async function setup(dir) {
  const now = fakeClock();
  const store = new StateStore({ dir: dir ?? (await tempDataDir()) });
  await store.load();
  return { now, store, gladys: createFakeGladys(), watcher: new TriggerWatcher({ store, now }) };
}

const entry = (overrides = {}) => ({
  current: current(),
  hourly: hourly(),
  daily: daily({ minimums: [8, 6, 5, 3, 4] }),
  alerts: [],
  ...overrides,
});

const keys = (gladys) => gladys.fake.sceneEvents.map((event) => event.key);

test('the first reading only arms the triggers', async () => {
  const { gladys, watcher } = await setup();
  const result = await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ alerts: [alert()], hourly: hourly({ wetFrom: 0 }) }),
  });
  assert.deepEqual(result.fired, []);
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('a new alert fires once, with its details', async () => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  const result = await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ alerts: [alert()] }),
  });
  assert.equal(result.alertsChanged, true);
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry({ alerts: [alert()] }) });
  assert.deepEqual(keys(gladys), [SCENE_TRIGGERS.WEATHER_ALERT]);
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    severity: 'severe',
    type: 'thunderstorm',
    event: 'Orange thunderstorm warning',
    description: 'Strong thunderstorms with hail are expected.',
    starts_at: '2026-10-16T12:00:00.000Z',
    ends_at: '2026-10-16T20:00:00.000Z',
    location: 'Paris',
  });
});

test('an alert that ends changes the alerts, without an event', async () => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry({ alerts: [alert()] }) });
  const result = await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  assert.equal(result.alertsChanged, true);
  const again = await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  assert.equal(again.alertsChanged, false);
  assert.deepEqual(keys(gladys), []);
});

test('a change of sky fires condition_changed', async () => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ current: current({ WeatherIcon: 18, WeatherText: 'Rain' }) }),
  });
  assert.deepEqual(keys(gladys), [SCENE_TRIGGERS.CONDITION_CHANGED]);
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    condition: 'rain',
    previous_condition: 'partly-cloudy',
    description: 'Rain',
    temperature: 15.2,
    location: 'Paris',
  });
});

test('rain fires when it enters the 3-hour window, not while it stays there', async () => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ hourly: hourly({ wetFrom: 5 }) }),
  });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ hourly: hourly({ wetFrom: 2 }) }),
  });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ hourly: hourly({ wetFrom: 1 }) }),
  });
  assert.deepEqual(keys(gladys), [SCENE_TRIGGERS.RAIN_EXPECTED]);
  assert.deepEqual(gladys.fake.sceneEvents[0].data, {
    precipitation_type: 'rain',
    starts_at: new Date(NOW + 2 * 3600 * 1000).toISOString(),
    hours_until: 2,
    probability: 80,
    location: 'Paris',
  });
  // Dry again, then wet again: a new event.
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ hourly: hourly({ wetFrom: 0 }) }),
  });
  assert.equal(keys(gladys).length, 2);
});

test('frost fires once per forecast date', async () => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ daily: daily({ minimums: [8, 6, -1, 3, 4] }) }),
  });
  await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ daily: daily({ minimums: [8, -2, -1, 3, 4] }) }),
  });
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.data.date),
    ['2026-10-18', '2026-10-17'],
  );
  assert.equal(gladys.fake.sceneEvents[0].data.temperature_min, -1);
});

test('a restart does not fire again what was already said', async () => {
  const dir = await tempDataDir();
  const first = await setup(dir);
  await first.watcher.evaluate(first.gladys, { location: LOCATION, entry: entry() });
  await first.watcher.evaluate(first.gladys, {
    location: LOCATION,
    entry: entry({ alerts: [alert()] }),
  });
  await first.store.save();

  const second = await setup(dir);
  await second.watcher.evaluate(second.gladys, {
    location: LOCATION,
    entry: entry({ alerts: [alert()] }),
  });
  assert.deepEqual(second.gladys.fake.sceneEvents, []);
});

test('a refused event never fails the refresh', async (t) => {
  const { gladys, watcher } = await setup();
  await watcher.evaluate(gladys, { location: LOCATION, entry: entry() });
  t.mock.method(gladys, 'publishSceneEvent', async () => {
    throw new Error('404 unknown trigger');
  });
  const result = await watcher.evaluate(gladys, {
    location: LOCATION,
    entry: entry({ alerts: [alert()] }),
  });
  assert.deepEqual(result.fired, []);
});

test('helpers', () => {
  assert.equal(firstWetHour(hourly(), NOW), null);
  assert.equal(firstWetHour(hourly({ wetFrom: 4 }), NOW), null);
  assert.equal(firstWetHour(hourly({ wetFrom: 3 }), NOW).time, NOW + 3 * 3600 * 1000);
  assert.deepEqual(frostDays(daily({ minimums: [1, 0, -3] })), [
    { date: '2026-10-17', min: 0 },
    { date: '2026-10-18', min: -3 },
  ]);
});
