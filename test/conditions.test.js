import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import {
  ICON_CONDITIONS,
  SKY_CONDITIONS,
  alertTypeOf,
  conditionOf,
  currentConditionOf,
  dayConditionOf,
  hourConditionOf,
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
  assert.equal(conditionOf(18, { intensity: 'Heavy' }), WEATHER_CONDITIONS.POURING);
  assert.equal(conditionOf(22, { intensity: 'Heavy' }), WEATHER_CONDITIONS.SNOW);
  assert.equal(conditionOf(33), WEATHER_CONDITIONS.CLEAR);
});

test('the details of the entry make the icon more precise', () => {
  // A thunderstorm falling as snow.
  assert.equal(conditionOf(15, { precipitationType: 'Snow' }), 'snow-thunderstorm');
  assert.equal(conditionOf(42, { precipitationType: 'Snow' }), 'snow-thunderstorm');
  assert.equal(conditionOf(15, { precipitationType: 'Rain' }), WEATHER_CONDITIONS.THUNDERSTORM);
  // Fog at or below 0 °C.
  assert.equal(conditionOf(11, { temperature: -2.5 }), 'freezing-fog');
  assert.equal(conditionOf(11, { temperature: 0 }), 'freezing-fog');
  assert.equal(conditionOf(11, { temperature: 3 }), WEATHER_CONDITIONS.FOG);
  // An unknown temperature is no frost.
  assert.equal(conditionOf(11, { temperature: null }), WEATHER_CONDITIONS.FOG);
  assert.equal(conditionOf(11, { temperature: '' }), WEATHER_CONDITIONS.FOG);
  // The details only refine their own phenomenon.
  assert.equal(conditionOf(1, { temperature: -10, precipitationType: 'Snow' }), 'clear');
});

test('current conditions, hours and days read their own fields', () => {
  assert.equal(
    currentConditionOf({
      WeatherIcon: 11,
      Temperature: { Metric: { Value: -1 }, Imperial: { Value: 30 } },
    }),
    'freezing-fog',
  );
  assert.equal(
    currentConditionOf({ WeatherIcon: 15, HasPrecipitation: true, PrecipitationType: 'Snow' }),
    'snow-thunderstorm',
  );
  // A precipitation type the entry says is not falling is ignored.
  assert.equal(
    currentConditionOf({ WeatherIcon: 15, HasPrecipitation: false, PrecipitationType: 'Snow' }),
    WEATHER_CONDITIONS.THUNDERSTORM,
  );
  assert.equal(
    hourConditionOf({ WeatherIcon: 18, PrecipitationIntensity: 'Heavy' }),
    WEATHER_CONDITIONS.POURING,
  );
  assert.equal(
    hourConditionOf({ WeatherIcon: 11, Temperature: { Value: -3, Unit: 'C' } }),
    'freezing-fog',
  );
  assert.equal(
    dayConditionOf({
      Temperature: { Minimum: { Value: -6 }, Maximum: { Value: -1 } },
      Day: { Icon: 11 },
    }),
    'freezing-fog',
  );
  assert.equal(
    dayConditionOf({
      Temperature: { Minimum: { Value: -6 }, Maximum: { Value: 4 } },
      Day: { Icon: 11 },
    }),
    WEATHER_CONDITIONS.FOG,
  );
  assert.equal(
    dayConditionOf({ Day: { Icon: 18, HasPrecipitation: true, PrecipitationIntensity: 'Heavy' } }),
    WEATHER_CONDITIONS.POURING,
  );
  assert.equal(dayConditionOf({ Day: {} }), undefined);
});

test('no AccuWeather entry ever becomes the deprecated "night" condition', () => {
  const pivot = new Set(Object.values(WEATHER_CONDITIONS));
  for (const condition of SKY_CONDITIONS) {
    assert.ok(pivot.has(condition), condition);
    assert.notEqual(condition, WEATHER_CONDITIONS.NIGHT);
  }
  for (const icon of ICONS) {
    for (const details of [
      { intensity: 'Heavy', precipitationType: 'Snow', temperature: -5 },
      { precipitationType: 'Rain', temperature: 20 },
    ]) {
      assert.notEqual(conditionOf(icon, details), WEATHER_CONDITIONS.NIGHT, `icon ${icon}`);
    }
  }
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

test('alert names holding two phenomena get the most precise type', () => {
  const typeOf = (name) => alertTypeOf({ Description: { English: name } });
  assert.equal(typeOf('Freezing Fog Advisory'), 'fog');
  assert.equal(typeOf('Freezing Rain Advisory'), 'snow');
  assert.equal(typeOf('Ice Storm Warning'), 'snow');
  assert.equal(typeOf('Freeze Warning'), 'cold');
  assert.equal(typeOf('Frost Advisory'), 'cold');
  assert.equal(typeOf('Wind Chill Warning'), 'cold');
  assert.equal(typeOf('Storm Surge Warning'), 'coastal');
  assert.equal(typeOf('Tsunami Warning'), 'coastal');
  assert.equal(typeOf('Rip Current Statement'), 'coastal');
  assert.equal(typeOf('Dust Storm Warning'), 'wind');
  assert.equal(typeOf('Tornado Warning'), 'wind');
  assert.equal(typeOf('Hurricane Warning'), 'wind');
  assert.equal(typeOf('Avalanche Warning'), 'avalanche');
  assert.equal(alertTypeOf({ Category: 'RAIN' }), 'rain');
  assert.equal(alertTypeOf({ Category: 'NEIGE-VERGLAS' }), 'snow');
  assert.equal(alertTypeOf({ Category: 'GRAND FROID' }), 'cold');
  // "sand" inside a word is no sandstorm.
  assert.equal(typeOf('Thousand Islands notice'), undefined);
});

test('precipitation types', () => {
  assert.equal(precipitationTypeOf('Rain'), 'rain');
  assert.equal(precipitationTypeOf('Snow'), 'snow');
  assert.equal(precipitationTypeOf('Ice'), 'ice');
  assert.equal(precipitationTypeOf('Mixed'), 'mixed');
  assert.equal(precipitationTypeOf(undefined), 'rain');
});
