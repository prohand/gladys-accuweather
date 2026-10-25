import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEATHER_ALERT_SEVERITIES, WEATHER_CONDITIONS } from '@gladysassistant/integration-sdk';
import { UNITS, toPivot, windSpeed } from '../src/accuweather/pivot.js';
import { alert, current, daily, hourly } from './helpers/fakeAccuWeather.js';

const data = {
  current: current(),
  hourly: hourly({ wetFrom: 2 }),
  daily: daily(),
  alerts: [alert()],
};

test('metric: °C, m/s, hPa, mm, km', () => {
  const pivot = toPivot(data, UNITS.METRIC);
  assert.equal(pivot.temperature, 15.2);
  assert.equal(pivot.apparent_temperature, 14);
  assert.equal(pivot.weather, WEATHER_CONDITIONS.PARTLY_CLOUDY);
  assert.equal(pivot.wind_speed, 5); // 18 km/h
  assert.equal(pivot.wind_gust, 10); // 36 km/h
  assert.equal(pivot.wind_direction, 225);
  assert.equal(pivot.pressure, 1016);
  assert.equal(pivot.visibility, 16.1);
  assert.equal(pivot.humidity, 72);
  assert.equal(pivot.is_day, true);
  assert.equal(pivot.sunrise, '2026-10-16T06:12:00.000Z');
  assert.equal(pivot.datetime, '2026-10-16T10:00:00.000Z');
});

test('us: °F, mph, inHg, in, mi', () => {
  const pivot = toPivot(data, UNITS.US);
  assert.equal(pivot.temperature, 59);
  assert.equal(pivot.pressure, 30);
  assert.equal(pivot.visibility, 10);
  assert.equal(pivot.wind_speed, 11.2);
  assert.equal(pivot.hours[0].temperature, 59); // 15 °C
  assert.equal(pivot.hours[2].precipitation, 0.05); // 1.2 mm
  assert.equal(pivot.days[0].temperature_min, 46.4); // 8 °C
  assert.equal(windSpeed(16.09344, UNITS.US), 10);
});

test('hours, days and alerts are within the bounds of the pivot', () => {
  const pivot = toPivot(data, UNITS.METRIC);
  assert.equal(pivot.hours.length, 12);
  assert.equal(pivot.hours[2].weather, WEATHER_CONDITIONS.RAIN);
  assert.equal(pivot.hours[2].precipitation_probability, 80);
  assert.equal(pivot.hours[0].is_day, true);
  assert.equal(pivot.hours[9].is_day, false);
  assert.equal(pivot.days.length, 5);
  assert.equal(pivot.days[1].precipitation, 4);
  assert.equal(pivot.days[1].precipitation_probability, 70);
  assert.equal(pivot.days[0].uv_index, 3);
  assert.deepEqual(pivot.alerts, [
    {
      severity: WEATHER_ALERT_SEVERITIES.SEVERE,
      event: 'Orange thunderstorm warning',
      type: 'thunderstorm',
      description: 'Strong thunderstorms with hail are expected.',
      start: '2026-10-16T12:00:00.000Z',
      end: '2026-10-16T20:00:00.000Z',
    },
  ]);
});

test('parts turned off are simply absent', () => {
  const pivot = toPivot({ current: current() }, UNITS.METRIC);
  assert.equal(pivot.hours, undefined);
  assert.equal(pivot.days, undefined);
  assert.equal(pivot.alerts, undefined);
  assert.deepEqual(toPivot({ current: current(), alerts: [] }, UNITS.METRIC).alerts, []);
});

test('no temperature, no payload: the core would refuse it', () => {
  assert.throws(() => toPivot({ current: current({ Temperature: {} }) }, UNITS.METRIC));
  assert.throws(() => toPivot({}, UNITS.METRIC));
});

test('a night keeps its meteorology: `is_day` carries the night, never "night"', () => {
  const night = toPivot(
    { current: current({ WeatherIcon: 40, IsDayTime: false, WeatherText: 'Showers' }) },
    UNITS.METRIC,
  );
  assert.equal(night.weather, WEATHER_CONDITIONS.RAIN);
  assert.equal(night.is_day, false);
});

test('the payload carries the precise conditions of the 0.16 pivot', () => {
  const freezing = toPivot(
    {
      current: current({
        WeatherIcon: 11,
        IsDayTime: false,
        Temperature: { Metric: { Value: -3 }, Imperial: { Value: 26.6 } },
      }),
      hourly: hourly().map((hour, index) =>
        index === 0
          ? { ...hour, WeatherIcon: 15, HasPrecipitation: true, PrecipitationType: 'Snow' }
          : hour,
      ),
    },
    UNITS.METRIC,
  );
  assert.equal(freezing.weather, WEATHER_CONDITIONS.FREEZING_FOG);
  assert.equal(freezing.is_day, false);
  assert.equal(freezing.hours[0].weather, WEATHER_CONDITIONS.SNOW_THUNDERSTORM);
});
