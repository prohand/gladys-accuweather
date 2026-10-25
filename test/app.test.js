// -----------------------------------------------------------------------------
// The whole integration, as Gladys sees it: the fake Gladys of the SDK on one
// side, a fake AccuWeather on the other.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../src/app.js';
import { alert, fakeAccuWeather, fakeClock, tempDataDir } from './helpers/fakeAccuWeather.js';

const HOUSES = [
  { id: 'h0', name: 'Cabin', selector: 'cabin', latitude: null, longitude: null },
  { id: 'h1', name: 'Home', selector: 'home', latitude: 48.8566, longitude: 2.3522 },
];

async function start({ config = { api_key: 'key' }, houses = HOUSES, routes } = {}) {
  const now = fakeClock();
  const fake = fakeAccuWeather(routes);
  const gladys = createFakeGladys({ config, houses });
  const app = createApp(gladys, {
    fetch: fake.fetch,
    dataDir: await tempDataDir(),
    now,
    timers: false,
  });
  await gladys.connect();
  return { gladys, fake, app, now };
}

test('on connection, the first located house is watched and refreshed', async () => {
  const { gladys, fake, app } = await start();
  assert.equal(app.service.home.name, 'Home');
  assert.equal(fake.requests.length, 5);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.ok(gladys.fake.widgetRefreshes.includes('accuweather_now'));
});

test('Gladys gets the pivot weather in the unit system it asks for, from the cache', async () => {
  const { gladys, fake } = await start();
  const ack = await gladys.fake.weatherGet({
    latitude: 48.8566,
    longitude: 2.3522,
    language: 'fr',
    units: 'us',
  });
  assert.equal(ack.success, true);
  assert.equal(ack.data.weather.temperature, 59);
  assert.equal(ack.data.weather.hours.length, 12);
  assert.equal(ack.data.weather.days.length, 5);
  assert.equal(fake.requests.length, 5);
});

test('without an API key, the weather request fails so the core falls back', async () => {
  const { gladys, fake } = await start({ config: {} });
  const ack = await gladys.fake.weatherGet({
    latitude: 1,
    longitude: 2,
    language: 'en',
    units: 'metric',
  });
  assert.equal(ack.success, false);
  assert.equal(fake.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
});

test('a new alert fires the trigger and nudges the core weather', async () => {
  const { gladys, fake, now, app } = await start();
  fake.answers.alerts = [alert()];
  now.advance(120 * 60 * 1000);
  await app.tick();
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => event.key),
    ['weather_alert'],
  );
  assert.equal(gladys.fake.weatherRefreshes, 1);
});

test('the Configuration screen buttons answer in every language', async () => {
  const { gladys } = await start();
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /^Connected\. Paris, Île-de-France \(key 623\)/);
  assert.match(ack.data.message.de, /^Verbunden\./);
  const refresh = await gladys.fake.action('refresh_now', {});
  assert.match(refresh.data.message.en, /Already up to date/);
});

test('a refused key is explained under the button and in the status', async () => {
  const { gladys } = await start({ routes: { geoposition: { status: 401, body: '' } } });
  const ack = await gladys.fake.action('test_connection', {});
  assert.match(ack.data.message.en, /refused the API key/);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /refuse la clé/);
});

test('saving a new key refreshes at once and nudges the core', async () => {
  const { gladys, fake } = await start({ config: {} });
  assert.equal(fake.requests.length, 0);
  await gladys.fake.configUpdated({ api_key: 'new-key', language: 'de' });
  assert.equal(fake.requests.length, 5);
  assert.ok(fake.requests.every((request) => request.query.language === 'de'));
  assert.equal(gladys.fake.weatherRefreshes, 1);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('scene actions and widgets are reachable through Gladys', async () => {
  const { gladys } = await start();
  const forecast = await gladys.fake.sceneAction('get_forecast', { day: 'tomorrow' });
  assert.equal(forecast.success, true);
  assert.equal(forecast.data.outputs.rain_expected, true);
  const widget = await gladys.fake.widgetGet('accuweather_forecast', { language: 'es' });
  assert.equal(widget.success, true);
  const tap = await gladys.fake.widgetAction('accuweather_now', 'refresh', {}, { settings: {} });
  assert.equal(tap.success, true);
});

test('the house picked in the configuration is the one watched', async () => {
  const houses = [
    ...HOUSES,
    { id: 'h2', name: 'Seaside', selector: 'seaside', latitude: 43.2965, longitude: 5.3698 },
  ];
  const { app, fake } = await start({ config: { api_key: 'key', house: 'seaside' }, houses });
  assert.equal(app.service.home.name, 'Seaside');
  assert.ok(fake.requests.some((request) => String(request.query.q ?? '').includes('43.2965')));
});

test('a picked house that is not on the map watches nothing, never another house', async () => {
  const { app, fake, gladys } = await start({ config: { api_key: 'key', house: 'cabin' } });
  assert.equal(app.service.home, null);
  assert.equal(fake.requests.length, 0);
  // Picking another house is applied at once.
  await gladys.fake.configUpdated({ api_key: 'key', house: 'home' });
  assert.equal(app.service.home.name, 'Home');
});

test('without a located house, Gladys still gets its weather', async () => {
  const { gladys, fake } = await start({ houses: [] });
  assert.equal(fake.requests.length, 0);
  const ack = await gladys.fake.weatherGet({
    latitude: 45.764,
    longitude: 4.8357,
    language: 'en',
    units: 'metric',
  });
  assert.equal(ack.success, true);
  const widget = await gladys.fake.widgetGet('accuweather_now', {});
  assert.match(widget.data.content.components[0].text.en, /position of your house/);
});
