import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AccuWeatherClient,
  ERROR_KINDS,
  QUOTA_WINDOW_MS,
  errorFor,
} from '../src/accuweather/client.js';
import { fakeAccuWeather, fakeClock, LOCATION_KEY } from './helpers/fakeAccuWeather.js';

test('the key travels in the Authorization header, never in the URL', async () => {
  const fake = fakeAccuWeather();
  const client = new AccuWeatherClient({ fetch: fake.fetch });
  await client.currentConditions('secret-key', LOCATION_KEY, 'fr');
  const [request] = fake.requests;
  assert.equal(request.init.headers.Authorization, 'Bearer secret-key');
  assert.equal(request.path, `/currentconditions/v1/${LOCATION_KEY}`);
  assert.deepEqual(request.query, { details: 'true', language: 'fr' });
  assert.ok(!JSON.stringify(request.query).includes('secret-key'));
});

test('forecasts are always asked in metric', async () => {
  const fake = fakeAccuWeather();
  const client = new AccuWeatherClient({ fetch: fake.fetch });
  await client.hourlyForecast('k', LOCATION_KEY, 'en');
  await client.dailyForecast('k', LOCATION_KEY, 'en');
  assert.ok(fake.requests.every((request) => request.query.metric === 'true'));
  assert.equal(fake.requests[0].path, `/forecasts/v1/hourly/12hour/${LOCATION_KEY}`);
  assert.equal(fake.requests[1].path, `/forecasts/v1/daily/5day/${LOCATION_KEY}`);
});

test('the geoposition search sends "lat,lon"', async () => {
  const fake = fakeAccuWeather();
  const client = new AccuWeatherClient({ fetch: fake.fetch });
  const found = await client.geopositionSearch('k', 48.8566, 2.3522, 'en');
  assert.equal(found.Key, LOCATION_KEY);
  assert.equal(fake.requests[0].query.q, '48.8566,2.3522');
});

test('no key, no request', async () => {
  const fake = fakeAccuWeather();
  const client = new AccuWeatherClient({ fetch: fake.fetch });
  await assert.rejects(client.currentConditions('', LOCATION_KEY, 'en'), {
    kind: ERROR_KINDS.AUTH,
  });
  assert.equal(fake.requests.length, 0);
});

test('refusals are told apart', () => {
  assert.equal(errorFor(401, '', '/x').kind, ERROR_KINDS.AUTH);
  assert.equal(errorFor(403, '', '/x').kind, ERROR_KINDS.FORBIDDEN);
  assert.equal(
    errorFor(
      503,
      '{"Code":"ServiceUnavailable","Message":"The allowed number of requests has been exceeded."}',
      '/x',
    ).kind,
    ERROR_KINDS.QUOTA,
  );
  assert.equal(errorFor(429, '', '/x').kind, ERROR_KINDS.QUOTA);
  assert.equal(errorFor(503, 'maintenance', '/x').kind, ERROR_KINDS.HTTP);
  assert.equal(errorFor(404, '', '/x').kind, ERROR_KINDS.NOT_FOUND);
});

test('a refused key is reported as such, without the key', async () => {
  const fake = fakeAccuWeather({ current: { status: 401, body: 'Unauthorized' } });
  const client = new AccuWeatherClient({ fetch: fake.fetch });
  await assert.rejects(client.currentConditions('my-secret', LOCATION_KEY, 'en'), (err) => {
    assert.equal(err.kind, ERROR_KINDS.AUTH);
    assert.ok(!err.message.includes('my-secret'));
    return true;
  });
});

test('a network failure is a network error', async () => {
  const client = new AccuWeatherClient({
    fetch: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  await assert.rejects(client.alerts('k', LOCATION_KEY, 'en'), { kind: ERROR_KINDS.NETWORK });
});

test('calls are counted over a rolling day, refused ones included', async () => {
  const now = fakeClock();
  const fake = fakeAccuWeather({ alerts: { status: 503, body: 'exceeded' } });
  const client = new AccuWeatherClient({ fetch: fake.fetch, now });
  await client.currentConditions('k', LOCATION_KEY, 'en');
  await client.alerts('k', LOCATION_KEY, 'en').catch(() => {});
  assert.equal(client.callsLast24h(), 2);
  assert.equal(client.remaining, 42);
  now.advance(QUOTA_WINDOW_MS + 1);
  assert.equal(client.callsLast24h(), 0);
});
