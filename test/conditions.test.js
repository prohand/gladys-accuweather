import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import {
  ICON_CONDITIONS,
  alertTypeOf,
  conditionOf,
  precipitationTypeOf,
  severityOf,
} from '../src/accuweather/conditions.js';

// The icons AccuWeather documents (9, 10, 27 and 28 do not exist).
const ICONS = [
  ...Array.from({ length: 8 }, (_, i) => i + 1),
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  ...Array.from({ length: 16 }, (_, i) => i + 29),
];

test('every AccuWeather icon maps to a pivot condition', () => {
  const pivot = new Set(Object.values(WEATHER_CONDITIONS));
  for (const icon of ICONS) {
    const condition = ICON_CONDITIONS[icon];
    assert.ok(condition, `icon ${icon} is not mapped`);
    assert.ok(pivot.has(condition), `icon ${icon}: ${condition} is not a pivot condition`);
    // `night` is deprecated for providers: is_day carries the night.
    assert.notEqual(condition, WEATHER_CONDITIONS.NIGHT);
  }
});

test('an unknown icon is "unknown", heavy rain is "pouring"', () => {
  assert.equal(conditionOf(99), WEATHER_CONDITIONS.UNKNOWN);
  assert.equal(conditionOf(18), WEATHER_CONDITIONS.RAIN);
  assert.equal(conditionOf(18, 'Heavy'), WEATHER_CONDITIONS.POURING);
  assert.equal(conditionOf(22, 'Heavy'), WEATHER_CONDITIONS.SNOW);
  assert.equal(conditionOf(33), WEATHER_CONDITIONS.CLEAR);
});

test('alert colours and US levels become CAP severities', () => {
  assert.equal(severityOf({ Color: { Name: 'Yellow' } }), 'moderate');
  assert.equal(severityOf({ Color: { Name: 'Orange' } }), 'severe');
  assert.equal(severityOf({ Level: 'Red' }), 'extreme');
  assert.equal(severityOf({ Color: { Name: 'Green' } }), 'minor');
  assert.equal(severityOf({ Description: { English: 'Flood Warning' } }), 'severe');
  assert.equal(severityOf({ Description: { English: 'Wind Advisory' } }), 'minor');
  assert.equal(severityOf({}), 'moderate');
});

test('alert phenomena are recognized from the category and the name', () => {
  assert.equal(alertTypeOf({ Category: 'THUNDERSTORM' }), 'thunderstorm');
  assert.equal(alertTypeOf({ Description: { English: 'Winter Storm Warning' } }), 'snow');
  assert.equal(alertTypeOf({ Description: { English: 'High Wind Warning' } }), 'wind');
  assert.equal(alertTypeOf({ Description: { English: 'Excessive Heat Warning' } }), 'heat');
  assert.equal(alertTypeOf({ Description: { English: 'Coastal Flood Advisory' } }), 'flood');
  assert.equal(alertTypeOf({ Description: { English: 'Dense Fog Advisory' } }), 'fog');
  assert.equal(alertTypeOf({ Description: { English: 'Special Weather Statement' } }), undefined);
  // "ice" inside a word is no ice, "vent" inside "event" is no wind.
  assert.equal(alertTypeOf({ Description: { English: 'Public notice event' } }), undefined);
});

test('precipitation types', () => {
  assert.equal(precipitationTypeOf('Rain'), 'rain');
  assert.equal(precipitationTypeOf('Snow'), 'snow');
  assert.equal(precipitationTypeOf('Ice'), 'ice');
  assert.equal(precipitationTypeOf('Mixed'), 'mixed');
  assert.equal(precipitationTypeOf(undefined), 'rain');
});
