// -----------------------------------------------------------------------------
// AccuWeather HTTP client.
//
// One request per call, nothing cached here (the cache lives in service.js).
// The client only knows how to ask, how to authenticate and how to read a
// refusal: AccuWeather answers a bad key with 401, an endpoint the plan does
// not include with 403, and an exhausted daily quota with 503 (some gateways
// with 429) — three situations the user fixes in three different places, so
// they are told apart here once.
//
// The API key travels in the `Authorization: Bearer` header, never in the URL:
// URLs end up in logs and error messages, headers do not.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'accuweather' });

export const API_BASE_URL = 'https://dataservice.accuweather.com';

/** A request that takes longer than this is abandoned (Gladys waits 15 s). */
export const REQUEST_TIMEOUT_MS = 10_000;

/** Calls older than this no longer count against the daily quota. */
export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Why a request failed, as the rest of the code reacts to it. */
export const ERROR_KINDS = {
  /** No API key, or an invalid one (401). */
  AUTH: 'auth',
  /** The key is valid but the plan does not include this endpoint (403). */
  FORBIDDEN: 'forbidden',
  /** The daily quota is spent (503 / 429). */
  QUOTA: 'quota',
  /** Unknown location key (404) or an empty answer. */
  NOT_FOUND: 'not_found',
  /** Any other HTTP status. */
  HTTP: 'http',
  /** DNS, TLS, timeout: AccuWeather was not reached. */
  NETWORK: 'network',
};

export class AccuWeatherError extends Error {
  /**
   * @param {string} message
   * @param {{ kind: string, status?: number }} details
   */
  constructor(message, { kind, status } = {}) {
    super(message);
    this.name = 'AccuWeatherError';
    this.kind = kind;
    this.status = status;
  }
}

export class AccuWeatherClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] injected in the tests: they never touch the network
   * @param {() => number} [options.now] clock
   * @param {string} [options.baseUrl]
   * @param {number[]} [options.calls] timestamps of the calls already made (restored from /data)
   */
  constructor({
    fetch: fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    baseUrl = API_BASE_URL,
    calls = [],
  } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.baseUrl = baseUrl;
    this.calls = calls.filter((time) => Number.isFinite(time));
    /** Last `RateLimit-Remaining` header AccuWeather sent, null when it sent none. */
    this.remaining = null;
  }

  /** Requests made over the last 24 hours, as counted by this integration. */
  callsLast24h() {
    const since = this.now() - QUOTA_WINDOW_MS;
    this.calls = this.calls.filter((time) => time > since);
    return this.calls.length;
  }

  /**
   * GET one AccuWeather endpoint.
   * @param {string} apiKey
   * @param {string} path e.g. `/currentconditions/v1/623`
   * @param {Record<string, string | number | boolean>} [query]
   */
  async get(apiKey, path, query = {}) {
    if (!apiKey) {
      throw new AccuWeatherError('No AccuWeather API key configured', { kind: ERROR_KINDS.AUTH });
    }
    const url = new URL(path, this.baseUrl);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(name, String(value));
      }
    }
    logger.debug(`GET ${url.pathname}${url.search}`);

    // Counted before the answer: a request AccuWeather received and refused
    // still costs one call of the quota.
    this.calls.push(this.now());
    this.callsLast24h();

    let response;
    try {
      response = await this.fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new AccuWeatherError(`AccuWeather unreachable: ${err.message}`, {
        kind: ERROR_KINDS.NETWORK,
      });
    }

    // Sent on some plans only: what AccuWeather itself says is left today.
    const header = response.headers?.get?.('RateLimit-Remaining');
    if (header !== null && header !== undefined && Number.isFinite(Number(header))) {
      this.remaining = Number(header);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw errorFor(response.status, body, url.pathname);
    }
    return response.json();
  }

  /** The AccuWeather location (city) of a position: `{ Key, LocalizedName, ... }`. */
  async geopositionSearch(apiKey, latitude, longitude, language) {
    const location = await this.get(apiKey, '/locations/v1/cities/geoposition/search', {
      q: `${latitude},${longitude}`,
      language,
    });
    if (!location?.Key) {
      throw new AccuWeatherError(`No AccuWeather location at ${latitude},${longitude}`, {
        kind: ERROR_KINDS.NOT_FOUND,
      });
    }
    return location;
  }

  /** A location by its key, to check a key typed by hand. */
  async location(apiKey, locationKey, language) {
    const location = await this.get(apiKey, `/locations/v1/${encodeURIComponent(locationKey)}`, {
      language,
    });
    if (!location?.Key) {
      throw new AccuWeatherError(`Unknown AccuWeather location ${locationKey}`, {
        kind: ERROR_KINDS.NOT_FOUND,
      });
    }
    return location;
  }

  /** Current conditions, metric and imperial values side by side. */
  async currentConditions(apiKey, locationKey, language) {
    const answer = await this.get(
      apiKey,
      `/currentconditions/v1/${encodeURIComponent(locationKey)}`,
      { details: true, language },
    );
    const current = Array.isArray(answer) ? answer[0] : answer;
    if (!current) {
      throw new AccuWeatherError('Empty current conditions', { kind: ERROR_KINDS.NOT_FOUND });
    }
    return current;
  }

  /**
   * The next 12 hours. Always asked in metric: the US values are converted
   * locally, which halves the calls when users of both systems read it.
   */
  async hourlyForecast(apiKey, locationKey, language) {
    const answer = await this.get(
      apiKey,
      `/forecasts/v1/hourly/12hour/${encodeURIComponent(locationKey)}`,
      { details: true, metric: true, language },
    );
    return Array.isArray(answer) ? answer : [];
  }

  /** The next 5 days, in metric (see hourlyForecast). */
  async dailyForecast(apiKey, locationKey, language) {
    const answer = await this.get(
      apiKey,
      `/forecasts/v1/daily/5day/${encodeURIComponent(locationKey)}`,
      { details: true, metric: true, language },
    );
    return answer && typeof answer === 'object' ? answer : {};
  }

  /** The active severe weather alerts of a location. */
  async alerts(apiKey, locationKey, language) {
    const answer = await this.get(apiKey, `/alerts/v1/${encodeURIComponent(locationKey)}`, {
      details: true,
      language,
    });
    return Array.isArray(answer) ? answer : [];
  }
}

/** Turn an HTTP refusal into an error the rest of the code can act on. */
export function errorFor(status, body, path) {
  const text = String(body ?? '').slice(0, 300);
  if (status === 401) {
    return new AccuWeatherError(`AccuWeather refused the API key (401) on ${path}`, {
      kind: ERROR_KINDS.AUTH,
      status,
    });
  }
  if (status === 429 || (status === 503 && /allowed number of requests|exceeded/i.test(text))) {
    return new AccuWeatherError(`AccuWeather daily quota exceeded (${status})`, {
      kind: ERROR_KINDS.QUOTA,
      status,
    });
  }
  if (status === 403) {
    return new AccuWeatherError(`AccuWeather plan does not allow ${path} (403)`, {
      kind: ERROR_KINDS.FORBIDDEN,
      status,
    });
  }
  if (status === 404) {
    return new AccuWeatherError(`AccuWeather has nothing at ${path} (404)`, {
      kind: ERROR_KINDS.NOT_FOUND,
      status,
    });
  }
  return new AccuWeatherError(`AccuWeather HTTP ${status} on ${path}`, {
    kind: ERROR_KINDS.HTTP,
    status,
  });
}
