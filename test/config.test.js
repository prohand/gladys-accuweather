import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, maskKey, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  assert.equal(isConfigured(normalizeConfig()), false);
});

test('values typed in the form are cleaned up', () => {
  const config = normalizeConfig({
    api_key: '  abc123\n',
    language: 'fr',
    refresh_minutes: '90',
    hourly_forecast: 'false',
    alerts: false,
    location_key: ' 623 ',
  });
  assert.equal(config.api_key, 'abc123');
  assert.equal(config.language, 'fr');
  assert.equal(config.refresh_minutes, 90);
  assert.equal(config.hourly_forecast, false);
  assert.equal(config.alerts, false);
  assert.equal(config.location_key, '623');
  assert.equal(isConfigured(config), true);
});

test('the refresh interval stays within what the quota allows', () => {
  assert.equal(normalizeConfig({ refresh_minutes: 1 }).refresh_minutes, 30);
  assert.equal(normalizeConfig({ refresh_minutes: 99999 }).refresh_minutes, 1440);
  assert.equal(normalizeConfig({ refresh_minutes: 'abc' }).refresh_minutes, 120);
  assert.equal(normalizeConfig({ refresh_minutes: '' }).refresh_minutes, 120);
});

test('an unknown language falls back to English', () => {
  assert.equal(normalizeConfig({ language: 'it' }).language, 'en');
});

test('a location key keeps only the characters AccuWeather uses', () => {
  assert.equal(normalizeConfig({ location_key: '623_PC; drop' }).location_key, '623_PCdrop');
});

test('the API key is never shown in full', () => {
  assert.equal(maskKey('abcdefghijklmnop'), 'abcd…op');
  assert.equal(maskKey('short'), '****');
  assert.equal(maskKey(''), '');
});
