// -----------------------------------------------------------------------------
// A fake AccuWeather: a `fetch` answering the endpoints the integration calls,
// with answers shaped like the real ones (trimmed to the fields read). Tests
// never touch the network.
// -----------------------------------------------------------------------------

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const NOW = Date.parse('2026-10-16T10:00:00Z');
export const LOCATION_KEY = '623';

export function location() {
  return {
    Key: LOCATION_KEY,
    LocalizedName: 'Paris',
    EnglishName: 'Paris',
    AdministrativeArea: { LocalizedName: 'Île-de-France' },
  };
}

export function current(overrides = {}) {
  return {
    LocalObservationDateTime: '2026-10-16T12:00:00+02:00',
    WeatherText: 'Partly sunny',
    WeatherIcon: 3,
    IsDayTime: true,
    Temperature: { Metric: { Value: 15.2, Unit: 'C' }, Imperial: { Value: 59, Unit: 'F' } },
    RealFeelTemperature: { Metric: { Value: 14 }, Imperial: { Value: 57 } },
    RelativeHumidity: 72,
    DewPoint: { Metric: { Value: 10.1 }, Imperial: { Value: 50 } },
    Wind: {
      Direction: { Degrees: 225 },
      Speed: { Metric: { Value: 18 }, Imperial: { Value: 11.2 } },
    },
    WindGust: { Speed: { Metric: { Value: 36 }, Imperial: { Value: 22.4 } } },
    UVIndex: 2,
    Visibility: { Metric: { Value: 16.1 }, Imperial: { Value: 10 } },
    CloudCover: 45,
    Pressure: { Metric: { Value: 1016 }, Imperial: { Value: 30 } },
    Link: 'https://www.accuweather.com/en/fr/paris/623/current-weather/623',
    ...overrides,
  };
}

/** AccuWeather dates carry the local offset of the location (Paris: +02:00). */
export function parisTime(time) {
  return `${new Date(time + 2 * 3600 * 1000).toISOString().slice(0, 19)}+02:00`;
}

/** 12 hours from NOW; `wetFrom` makes the hours from that index on rainy. */
export function hourly({ wetFrom = null, start = NOW } = {}) {
  return Array.from({ length: 12 }, (_, index) => {
    const wet = wetFrom !== null && index >= wetFrom;
    return {
      DateTime: parisTime(start + index * 3600 * 1000),
      WeatherIcon: wet ? 18 : 2,
      IsDaylight: index < 8,
      HasPrecipitation: wet,
      ...(wet ? { PrecipitationType: 'Rain', PrecipitationIntensity: 'Moderate' } : {}),
      Temperature: { Value: 15 + index / 2, Unit: 'C' },
      RealFeelTemperature: { Value: 14 + index / 2 },
      RelativeHumidity: 70,
      Wind: { Speed: { Value: 14.4 }, Direction: { Degrees: 200 } },
      WindGust: { Speed: { Value: 25 } },
      CloudCover: wet ? 100 : 20,
      TotalLiquid: { Value: wet ? 1.2 : 0 },
      PrecipitationProbability: wet ? 80 : 5,
      UVIndex: 1,
    };
  });
}

export function daily({ minimums = [8, 6, -1, 3, 4] } = {}) {
  return {
    Headline: { Text: 'Rain Saturday morning', Link: 'https://www.accuweather.com/x' },
    DailyForecasts: minimums.map((min, index) => ({
      Date: `2026-10-${16 + index}T07:00:00+02:00`,
      Sun: {
        Rise: `2026-10-${16 + index}T08:12:00+02:00`,
        Set: `2026-10-${16 + index}T18:55:00+02:00`,
      },
      Temperature: { Minimum: { Value: min }, Maximum: { Value: min + 10 } },
      AirAndPollen: [{ Name: 'UVIndex', Value: 3 }],
      Day: {
        Icon: index === 1 ? 18 : 2,
        IconPhrase: index === 1 ? 'Rain' : 'Mostly sunny',
        HasPrecipitation: index === 1,
        PrecipitationProbability: index === 1 ? 70 : 10,
        Wind: { Speed: { Value: 18 }, Direction: { Degrees: 180 } },
        WindGust: { Speed: { Value: 30 } },
        TotalLiquid: { Value: index === 1 ? 4 : 0 },
        RelativeHumidity: { Average: 65 },
      },
      Night: {
        IconPhrase: 'Clear',
        HasPrecipitation: false,
        PrecipitationProbability: 5,
        TotalLiquid: { Value: 0 },
      },
      Link: 'https://www.accuweather.com/day',
    })),
  };
}

export function alert(overrides = {}) {
  return {
    AlertID: 4242,
    Category: 'THUNDERSTORM',
    Level: 'Orange',
    Color: { Name: 'Orange', Hex: '#FFA500' },
    Description: { Localized: 'Orange thunderstorm warning', English: 'Thunderstorm Warning' },
    Area: [
      {
        Name: 'Paris',
        StartTime: '2026-10-16T14:00:00+02:00',
        EndTime: '2026-10-16T22:00:00+02:00',
        Text: 'Strong thunderstorms with hail are expected.',
      },
    ],
    ...overrides,
  };
}

/**
 * A fake `fetch`. `routes` maps an endpoint family to its answer: a value,
 * a function returning one, or `{ status, body }` for a refusal.
 */
export function fakeAccuWeather(routes = {}) {
  const answers = {
    geoposition: location(),
    location: location(),
    current: [current()],
    hourly: hourly(),
    daily: daily(),
    alerts: [],
    ...routes,
  };
  const requests = [];
  const fetch = async (url, init) => {
    const target = new URL(url);
    requests.push({ path: target.pathname, query: Object.fromEntries(target.searchParams), init });
    const family = familyOf(target.pathname);
    let answer = answers[family];
    if (typeof answer === 'function') {
      answer = answer(target);
    }
    if (answer?.status) {
      return response(answer.status, answer.body ?? '', answer.headers);
    }
    return response(200, answer, { 'RateLimit-Remaining': '42' });
  };
  return { fetch, requests, answers };
}

function familyOf(path) {
  if (path.includes('/geoposition/')) return 'geoposition';
  if (path.startsWith('/locations/')) return 'location';
  if (path.startsWith('/currentconditions/')) return 'current';
  if (path.includes('/hourly/')) return 'hourly';
  if (path.includes('/daily/')) return 'daily';
  if (path.startsWith('/alerts/')) return 'alerts';
  return 'unknown';
}

function response(status, body, headers = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** A fresh, empty /data for one test. */
export function tempDataDir() {
  return mkdtemp(join(tmpdir(), 'accuweather-'));
}

/** A clock the test moves by hand. */
export function fakeClock(start = NOW) {
  let time = start;
  const now = () => time;
  now.advance = (ms) => {
    time += ms;
  };
  now.set = (value) => {
    time = value;
  };
  return now;
}
