// -----------------------------------------------------------------------------
// Scene actions and dashboard widgets, against a fake AccuWeather.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { AccuWeatherClient } from '../src/accuweather/client.js';
import { WeatherService } from '../src/accuweather/service.js';
import { StateStore } from '../src/accuweather/store.js';
import { SCENE_ACTIONS, buildSceneActions } from '../src/capabilities/scenes.js';
import { WIDGET_ACTIONS, WIDGET_KEYS, buildWidgets, dayName } from '../src/capabilities/widgets.js';
import { normalizeConfig } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  alert,
  fakeAccuWeather,
  fakeClock,
  hourly,
  tempDataDir,
} from './helpers/fakeAccuWeather.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

async function setup({ routes, config = { api_key: 'key' }, home = true } = {}) {
  const now = fakeClock();
  const fake = fakeAccuWeather(routes);
  const store = new StateStore({ dir: await tempDataDir() });
  const service = new WeatherService({
    client: new AccuWeatherClient({ fetch: fake.fetch, now }),
    store,
    now,
    config: normalizeConfig(config),
  });
  if (home) {
    service.setHome({ latitude: 48.8566, longitude: 2.3522, name: 'Home' });
  }
  return { fake, service, scenes: buildSceneActions(service), widgets: buildWidgets(service) };
}

const declaredOutputs = (key) =>
  manifest.scene_actions
    .find((action) => action.key === key)
    .outputs.map((output) => output.key)
    .sort();

test('every scene action returns exactly its declared outputs', async () => {
  const { scenes } = await setup();
  for (const key of Object.values(SCENE_ACTIONS)) {
    const outputs = await scenes[key]({});
    assert.deepEqual(Object.keys(outputs).sort(), declaredOutputs(key), key);
    const types = Object.fromEntries(
      manifest.scene_actions
        .find((action) => action.key === key)
        .outputs.map((o) => [o.key, o.type]),
    );
    for (const [name, value] of Object.entries(outputs)) {
      if (value !== null) {
        assert.equal(typeof value, types[name], `${key}.${name}`);
      }
    }
  }
});

test('get_forecast reads the day asked for, in the units asked for', async () => {
  const { scenes } = await setup();
  const tomorrow = await scenes.get_forecast({ day: 'tomorrow', units: 'metric' });
  assert.equal(tomorrow.condition, 'rain');
  assert.equal(tomorrow.rain_expected, true);
  assert.equal(tomorrow.temperature_min, 6);
  assert.equal(tomorrow.precipitation_probability, 70);
  const us = await scenes.get_forecast({ day: 'today', units: 'us' });
  assert.equal(us.temperature_max, 64.4); // 18 °C
  assert.equal(us.rain_expected, false);
});

test('get_current_conditions', async () => {
  const { scenes } = await setup();
  const now = await scenes.get_current_conditions({ units: 'metric' });
  assert.equal(now.temperature, 15.2);
  assert.equal(now.condition, 'partly-cloudy');
  assert.equal(now.is_day, true);
});

test('refresh_weather refreshes, then holds back for 5 minutes', async () => {
  const { scenes } = await setup();
  assert.equal((await scenes.refresh_weather({})).refreshed, true);
  const again = await scenes.refresh_weather({});
  assert.equal(again.refreshed, false);
  assert.equal(again.calls_last_24h, 5);
});

test('scene actions say why when Gladys has no located house', async () => {
  const { scenes } = await setup({ home: false });
  await assert.rejects(scenes.get_forecast({}), /No located house/);
});

// --- Widgets -----------------------------------------------------------------

const request = (language = 'en', units = 'metric', settings = {}) => ({
  settings,
  language,
  units,
});

test('every widget is rendered exactly as sent, in every language and unit system', async () => {
  const { widgets } = await setup({
    routes: {
      alerts: [alert(), alert({ AlertID: 7, Color: { Name: 'Yellow' } })],
      hourly: hourly({ wetFrom: 1 }),
    },
  });
  for (const key of Object.values(WIDGET_KEYS)) {
    for (const language of LANGUAGES) {
      for (const units of ['metric', 'us']) {
        const content = await widgets[key].get(request(language, units));
        assert.deepEqual(validateWidgetContent(content), [], `${key} ${language} ${units}`);
      }
    }
  }
});

test('the "now" widget shows the conditions, the curve and the alerts', async () => {
  const { widgets } = await setup({
    routes: { alerts: [alert()], hourly: hourly({ wetFrom: 1 }) },
  });
  const content = await widgets[WIDGET_KEYS.NOW].get(request());
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, [
    'text',
    'value',
    'value',
    'value',
    'value',
    'chart',
    'status',
    'button',
  ]);
  assert.equal(content.components[0].text, 'Paris, Île-de-France · Partly sunny');
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items[0].value, 'Orange thunderstorm warning');
  assert.equal(status.items[0].color, 'danger');
  assert.equal(status.items[1].value.en, 'from 13:00');
  const usTile = (await widgets[WIDGET_KEYS.NOW].get(request('en', 'us'))).components[1];
  assert.deepEqual([usTile.value, usTile.unit], [59, '°F']);
});

test('without the hourly forecast, the AccuWeather link takes the place of the curve', async () => {
  const { widgets } = await setup({ config: { api_key: 'key', hourly_forecast: false } });
  const content = await widgets[WIDGET_KEYS.NOW].get(request());
  assert.ok(!content.components.some((component) => component.type === 'chart'));
  assert.ok(content.components.some((component) => component.link?.url?.startsWith('https://')));
  assert.deepEqual(validateWidgetContent(content), []);
});

test('the forecast widget lists the days asked for', async () => {
  const { widgets } = await setup();
  const content = await widgets[WIDGET_KEYS.FORECAST].get(request('fr', 'metric', { days: 3 }));
  const list = content.components.find((component) => component.type === 'card-list');
  assert.equal(list.items.length, 3);
  assert.equal(list.items[1].subtitle, '6°C / 16°C · 70 %');
  assert.equal(list.items[1].badge.text.fr, 'Pluie');
  assert.equal(dayName('2026-10-17T07:00:00+02:00', 'fr'), 'sam. 17 oct.');
});

test('widgets explain what is missing instead of failing', async () => {
  const cases = [
    await setup({ config: {} }),
    await setup({ home: false }),
    await setup({ routes: { geoposition: { status: 401, body: '' } } }),
  ];
  for (const { widgets } of cases) {
    for (const key of Object.values(WIDGET_KEYS)) {
      const content = await widgets[key].get(request());
      assert.equal(content.components[0].type, 'text');
      assert.deepEqual(validateWidgetContent(content), []);
    }
  }
});

test('the refresh button answers a short toast; an unknown action fails', async () => {
  const { widgets } = await setup();
  for (const key of Object.values(WIDGET_KEYS)) {
    const message = await widgets[key].action(WIDGET_ACTIONS.REFRESH);
    for (const language of LANGUAGES) {
      assert.ok(message[language].length <= 200);
    }
    await assert.rejects(widgets[key].action('nope'), /Unknown widget action/);
  }
});
