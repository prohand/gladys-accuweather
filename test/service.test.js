import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccuWeatherClient, ERROR_KINDS } from '../src/accuweather/client.js';
import {
  FORCED_REFRESH_FLOOR_MS,
  MAX_STALE_MS,
  QUOTA_BACKOFF_MS,
  WeatherService,
} from '../src/accuweather/service.js';
import { StateStore } from '../src/accuweather/store.js';
import { normalizeConfig } from '../src/config.js';
import {
  alert,
  current,
  fakeAccuWeather,
  fakeClock,
  tempDataDir,
} from './helpers/fakeAccuWeather.js';

const MINUTE = 60 * 1000;
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

async function setup({ routes, config = {}, dir } = {}) {
  const now = fakeClock();
  const fake = fakeAccuWeather(routes);
  const store = new StateStore({ dir: dir ?? (await tempDataDir()) });
  await store.load();
  const client = new AccuWeatherClient({ fetch: fake.fetch, now, calls: store.state.calls });
  const service = new WeatherService({
    client,
    store,
    now,
    config: normalizeConfig({ api_key: 'key', ...config }),
  });
  service.setHome({ ...PARIS, name: 'Home' });
  return { now, fake, store, client, service };
}

const families = (fake) => fake.requests.map((request) => request.path.split('/')[1]);

test('the first request costs a location lookup and the four parts', async () => {
  const { fake, service } = await setup();
  const { location, entry } = await service.weatherAt(PARIS.latitude, PARIS.longitude);
  assert.equal(location.key, '623');
  assert.equal(location.name, 'Paris, Île-de-France');
  assert.ok(entry.current && entry.hourly && entry.daily && entry.alerts);
  assert.equal(fake.requests.length, 5);
});

test('within the refresh interval, everything is served from the cache', async () => {
  const { fake, now, service } = await setup();
  await service.pivotAt({ ...PARIS, units: 'metric' });
  now.advance(60 * MINUTE);
  await service.pivotAt({ ...PARIS, units: 'us' });
  assert.equal(fake.requests.length, 5);
});

test('past the interval, the daily forecast waits for its 3 hours', async () => {
  const { fake, now, service } = await setup();
  await service.homeWeather();
  fake.requests.length = 0;
  now.advance(120 * MINUTE);
  await service.homeWeather();
  assert.deepEqual(families(fake).sort(), ['alerts', 'currentconditions', 'forecasts']);
  fake.requests.length = 0;
  now.advance(60 * MINUTE);
  await service.homeWeather();
  assert.deepEqual(families(fake), ['forecasts']); // the daily, 3 h old now
});

test('turned-off parts are neither asked nor served', async () => {
  const { fake, service } = await setup({ config: { hourly_forecast: false, alerts: false } });
  const { entry } = await service.homeWeather();
  assert.equal(fake.requests.length, 3); // location, current, daily
  assert.equal(entry.hourly, undefined);
  assert.equal(entry.alerts, undefined);
});

test('readers asking at the same time share one refresh', async () => {
  const { fake, service } = await setup();
  await service.homeWeather(); // the location is known
  fake.requests.length = 0;
  service.state.weather['623'].fetched = {};
  await Promise.all([service.homeWeather(), service.homeWeather(), service.homeWeather()]);
  assert.equal(fake.requests.length, 4);
});

test('a forced refresh asks everything, at most once every 5 minutes', async () => {
  const { fake, now, service } = await setup();
  await service.homeWeather();
  fake.requests.length = 0;
  const first = await service.homeWeather({ force: true });
  assert.equal(first.refreshed.length, 4);
  const second = await service.homeWeather({ force: true });
  assert.equal(second.refreshed.length, 0);
  now.advance(FORCED_REFRESH_FLOOR_MS);
  assert.equal((await service.homeWeather({ force: true })).refreshed.length, 4);
});

test('a new language fetches the texts again', async () => {
  const { fake, service } = await setup();
  await service.homeWeather();
  fake.requests.length = 0;
  service.setConfig(normalizeConfig({ api_key: 'key', language: 'fr' }));
  await service.homeWeather();
  assert.equal(fake.requests.length, 4);
  assert.ok(fake.requests.every((request) => request.query.language === 'fr'));
});

test('alerts the plan refuses are no longer asked', async () => {
  const { fake, now, service } = await setup({ routes: { alerts: { status: 403, body: '' } } });
  const { entry, errors } = await service.homeWeather();
  assert.equal(errors.alerts.kind, ERROR_KINDS.FORBIDDEN);
  assert.equal(entry.alerts, undefined);
  assert.equal(service.lastError, null);
  fake.requests.length = 0;
  now.advance(120 * MINUTE);
  await service.homeWeather();
  assert.ok(!families(fake).includes('alerts'));
});

test('an exhausted quota keeps serving the cache and stops asking for an hour', async () => {
  const { fake, now, service } = await setup();
  await service.homeWeather();
  fake.answers.current = { status: 503, body: 'The allowed number of requests has been exceeded.' };
  now.advance(120 * MINUTE);
  const { entry } = await service.homeWeather();
  assert.equal(entry.current.WeatherText, 'Partly sunny');
  assert.equal(service.lastError.kind, ERROR_KINDS.QUOTA);
  fake.requests.length = 0;
  now.advance(30 * MINUTE);
  await service.homeWeather();
  assert.equal(fake.requests.length, 0);
  now.advance(QUOTA_BACKOFF_MS);
  fake.answers.current = [current()];
  await service.homeWeather();
  assert.equal(service.lastError, null);
});

test('a day-old answer is no longer served', async () => {
  const { fake, now, service } = await setup();
  await service.homeWeather();
  fake.answers.current = { status: 500, body: '' };
  now.advance(MAX_STALE_MS + MINUTE);
  await assert.rejects(service.homeWeather(), { kind: ERROR_KINDS.HTTP });
});

test('a refused key fails loudly when there is nothing cached', async () => {
  const { service } = await setup({ routes: { geoposition: { status: 401, body: '' } } });
  await assert.rejects(service.homeWeather(), { kind: ERROR_KINDS.AUTH });
  assert.equal(service.lastError.kind, ERROR_KINDS.AUTH);
  // A new key lifts the block at once.
  service.setConfig(normalizeConfig({ api_key: 'other' }));
  assert.equal(service.lastError, null);
});

test('a location key typed by hand skips the geoposition search', async () => {
  const { fake, service } = await setup({ config: { location_key: '178087' } });
  const { location } = await service.homeWeather();
  assert.equal(location.key, '178087');
  assert.ok(!fake.requests.some((request) => request.path.includes('geoposition')));
  assert.ok(fake.requests.some((request) => request.path === '/currentconditions/v1/178087'));
});

test('a restart pays for nothing already fetched', async () => {
  const dir = await tempDataDir();
  const first = await setup({ dir });
  await first.service.homeWeather();
  await first.store.save();

  const second = await setup({ dir });
  second.now.set(first.now() + 10 * MINUTE);
  await second.service.homeWeather();
  assert.equal(second.fake.requests.length, 0);
  assert.equal(second.client.callsLast24h(), 5);
});

test('the house listeners see every refresh of the house, and only those', async () => {
  const { now, service } = await setup();
  const seen = [];
  service.onHomeRefreshed(async (weather) => seen.push(weather.refreshed.length));
  await service.homeWeather();
  await service.homeWeather(); // cached: nothing new
  now.advance(120 * MINUTE);
  await service.weatherAt(PARIS.latitude, PARIS.longitude); // Gladys asking counts too
  await service.weatherAt(45.764, 4.8357); // another place does not
  assert.deepEqual(seen, [4, 3]);
});

test('alert answers keep their order', async () => {
  const { service } = await setup({ routes: { alerts: [alert(), alert({ AlertID: 2 })] } });
  const { entry } = await service.homeWeather();
  assert.deepEqual(
    entry.alerts.map((a) => a.AlertID),
    [4242, 2],
  );
});
