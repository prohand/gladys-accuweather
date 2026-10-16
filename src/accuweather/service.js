// -----------------------------------------------------------------------------
// The weather of a location, fetched from AccuWeather at most once per refresh
// interval, whoever asks for it.
//
// Three readers share it: Gladys (onWeatherGet, about every 30 minutes and on
// every dashboard opening), the dashboard widgets and the scene triggers. They
// all go through `weatherAt`, which only calls AccuWeather for the parts that
// are older than the refresh interval the user chose — the daily quota is the
// constraint everything here is built around:
//
//   one refresh = current conditions + 12-hour forecast + alerts (+ 5-day
//   forecast, kept at least 3 hours: it barely moves) = up to 4 requests.
//   Every 120 minutes (the default) that is 12 x 3 + 8 = 44 requests a day,
//   under the 50 the oldest free keys allow.
//
// A refresh that fails keeps serving the last answer (up to a day old): a
// stale forecast is better than the core falling back to another provider.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AccuWeatherError, ERROR_KINDS } from './client.js';
import { toPivot } from './pivot.js';

const logger = createLogger({ name: 'service' });

/** The four answers a location is made of. */
export const PARTS = {
  CURRENT: 'current',
  HOURLY: 'hourly',
  DAILY: 'daily',
  ALERTS: 'alerts',
};

const MINUTE = 60 * 1000;

/** The 5-day forecast is refreshed at most every 3 hours. */
export const DAILY_MIN_AGE_MS = 180 * MINUTE;

/** A forced refresh (button, scene) is not repeated within 5 minutes. */
export const FORCED_REFRESH_FLOOR_MS = 5 * MINUTE;

/** After "quota exceeded", AccuWeather is left alone for an hour. */
export const QUOTA_BACKOFF_MS = 60 * MINUTE;

/** Older than this, a cached answer is no longer served. */
export const MAX_STALE_MS = 24 * 60 * MINUTE;

/** Entries nobody asked for in a week are dropped from /data. */
const FORGET_AFTER_MS = 7 * 24 * 60 * MINUTE;

/** "48.857,2.352": ~100 m, the same house always lands on the same key. */
export function positionId(latitude, longitude) {
  return `${Number(latitude).toFixed(3)},${Number(longitude).toFixed(3)}`;
}

export class WeatherService {
  /**
   * @param {object} options
   * @param {import('./client.js').AccuWeatherClient} options.client
   * @param {import('./store.js').StateStore} options.store
   * @param {object} options.config normalized configuration
   * @param {() => number} [options.now]
   */
  constructor({ client, store, config, now = () => Date.now() }) {
    this.client = client;
    this.store = store;
    this.now = now;
    this.config = config;
    /** location key -> refresh in progress, so concurrent readers share one. */
    this.inflight = new Map();
    /** Parts the plan of the key does not include (403): not asked again. */
    this.forbidden = new Set();
    /** No request before this time (quota spent, key refused). */
    this.blockedUntil = 0;
    /** Last failure `{ kind, message, at }`, null once a refresh succeeds. */
    this.lastError = null;
    /** Last successful refresh time. */
    this.lastSuccess = null;
    /** Time of the last forced refresh, per location key. */
    this.lastForced = new Map();
    /** The house the widgets and the scene triggers watch: `{ latitude, longitude, name }`. */
    this.home = null;
  }

  get state() {
    return this.store.state;
  }

  /** A new configuration: a new key or plan deserves a fresh chance. */
  setConfig(config) {
    const keyChanged = config.api_key !== this.config.api_key;
    const languageChanged = config.language !== this.config.language;
    const locationChanged = config.location_key !== this.config.location_key;
    this.config = config;
    if (keyChanged) {
      this.forbidden.clear();
      this.blockedUntil = 0;
      this.lastError = null;
    }
    if (locationChanged) {
      // A manual location key replaces whatever the coordinates gave.
      this.state.locations = {};
    }
    return { keyChanged, languageChanged, locationChanged };
  }

  setHome(home) {
    this.home = home;
  }

  // --- Location --------------------------------------------------------------

  /**
   * The AccuWeather location of a position: the key typed in the
   * configuration when there is one, else a geoposition search, cached for
   * good in /data (a city does not move).
   */
  async locationAt(latitude, longitude) {
    if (this.config.location_key) {
      const cached = this.state.locations.manual;
      return cached?.key === this.config.location_key
        ? cached
        : { key: this.config.location_key, name: this.config.location_key };
    }
    const id = positionId(latitude, longitude);
    const cached = this.state.locations[id];
    if (cached?.key) {
      return cached;
    }
    this.assertNotBlocked();
    const found = await this.guard(() =>
      this.client.geopositionSearch(this.config.api_key, latitude, longitude, this.config.language),
    );
    const location = { key: String(found.Key), name: describeLocation(found) };
    this.state.locations[id] = location;
    logger.info(`Position ${id} is AccuWeather location ${location.key} (${location.name})`);
    await this.store.save();
    return location;
  }

  // --- Weather ---------------------------------------------------------------

  /**
   * The raw weather of a position, refreshed when due.
   * @param {number} latitude
   * @param {number} longitude
   * @param {{ force?: boolean }} [options] refresh every part now (5-minute floor)
   * @returns {Promise<{ location: object, entry: object, errors: object }>}
   */
  async weatherAt(latitude, longitude, { force = false } = {}) {
    const location = await this.locationAt(latitude, longitude);
    const pending = this.inflight.get(location.key);
    if (pending) {
      return pending;
    }
    const refresh = this.refresh(location, { force })
      .then(async (weather) => {
        // Whoever caused the refresh of the house (Gladys, a widget, a scene),
        // the scene triggers must see it.
        if (weather.refreshed.length > 0 && this.isHome(location)) {
          await this.notifyHomeRefreshed(weather);
        }
        return weather;
      })
      .finally(() => {
        this.inflight.delete(location.key);
      });
    this.inflight.set(location.key, refresh);
    return refresh;
  }

  /** Register `(weather) => Promise` run after each refresh of the watched house. */
  onHomeRefreshed(listener) {
    this.homeListeners = [...(this.homeListeners ?? []), listener];
  }

  async notifyHomeRefreshed(weather) {
    for (const listener of this.homeListeners ?? []) {
      try {
        await listener(weather);
      } catch (err) {
        logger.error('Home refresh listener failed', err);
      }
    }
  }

  /** Whether a location is the one of the watched house (same AccuWeather key). */
  isHome(location) {
    return Boolean(location?.key) && this.homeLocation()?.key === location.key;
  }

  /** The AccuWeather location of the watched house, from the cache only. */
  homeLocation() {
    if (!this.home) {
      return null;
    }
    if (this.config.location_key) {
      return { ...this.state.locations.manual, key: this.config.location_key };
    }
    return this.state.locations[positionId(this.home.latitude, this.home.longitude)] ?? null;
  }

  /** The pivot payload Gladys asked for (onWeatherGet). */
  async pivotAt({ latitude, longitude, units }) {
    const { entry } = await this.weatherAt(latitude, longitude);
    return toPivot(entry, units);
  }

  /** The weather of the watched house, or null when Gladys gave no located house. */
  async homeWeather(options) {
    if (!this.home) {
      return null;
    }
    return this.weatherAt(this.home.latitude, this.home.longitude, options);
  }

  /** The cached weather of the watched house, without any request. */
  cachedHome() {
    const location = this.homeLocation();
    const entry = location?.key ? this.state.weather[location.key] : null;
    return entry?.current ? { location, entry } : null;
  }

  /** Which parts are older than the refresh interval. */
  dueParts(entry, { force = false } = {}) {
    const now = this.now();
    const interval = this.config.refresh_minutes * MINUTE;
    const enabled = [
      PARTS.CURRENT,
      PARTS.DAILY,
      ...(this.config.hourly_forecast ? [PARTS.HOURLY] : []),
      ...(this.config.alerts ? [PARTS.ALERTS] : []),
    ].filter((part) => !this.forbidden.has(part));
    // Texts (alert names, phrases) are in the language of the request.
    const relanguage = entry && entry.language !== this.config.language;
    return enabled.filter((part) => {
      const fetched = entry?.fetched?.[part];
      if (force || relanguage || fetched === undefined) {
        return true;
      }
      const minAge = part === PARTS.DAILY ? Math.max(interval, DAILY_MIN_AGE_MS) : interval;
      // A minute of tolerance: the 120-minute refresh driven by a one-minute
      // timer must not slip to 121 minutes.
      return now - fetched >= minAge - MINUTE;
    });
  }

  async refresh(location, { force = false } = {}) {
    const now = this.now();
    const existing = this.state.weather[location.key];
    const lastForced = this.lastForced.get(location.key) ?? 0;
    const forced = force && now - lastForced >= FORCED_REFRESH_FLOOR_MS;
    if (forced) {
      this.lastForced.set(location.key, now);
    }

    let due = this.dueParts(existing, { force: forced });
    const errors = {};
    if (due.length > 0 && now < this.blockedUntil) {
      // Quota spent or key refused: serve what we have, ask nothing.
      errors.blocked = this.lastError;
      due = [];
    }

    const entry = {
      fetched: {},
      ...existing,
      name: location.name ?? existing?.name,
      used: now,
    };
    if (due.length > 0) {
      logger.info(`Refreshing ${location.key} (${due.join(', ')})`);
      const results = await Promise.allSettled(
        due.map((part) => this.fetchPart(part, location.key)),
      );
      due.forEach((part, index) => {
        const result = results[index];
        if (result.status === 'fulfilled') {
          entry[part] = result.value;
          entry.fetched = { ...entry.fetched, [part]: now };
          return;
        }
        errors[part] = result.reason;
        if (result.reason?.kind === ERROR_KINDS.FORBIDDEN && part !== PARTS.CURRENT) {
          // The plan does not include it (alerts are not in every plan): stop
          // spending a call on it at every refresh.
          logger.warn(`AccuWeather refuses ${part} with this key: no longer asked`);
          this.forbidden.add(part);
        }
      });
      if (results.some((result) => result.status === 'fulfilled')) {
        entry.language = this.config.language;
      }
      this.noteOutcome(errors);
    }
    // Parts the user turned off are not served from an old cache.
    if (!this.config.hourly_forecast || this.forbidden.has(PARTS.HOURLY)) {
      delete entry.hourly;
    }
    if (!this.config.alerts || this.forbidden.has(PARTS.ALERTS)) {
      delete entry.alerts;
    }

    if (!entry.current || now - (entry.fetched.current ?? 0) > MAX_STALE_MS) {
      const cause = errors.current ?? errors.blocked;
      throw cause instanceof Error
        ? cause
        : new AccuWeatherError(cause?.message ?? 'No weather available yet', {
            kind: cause?.kind ?? ERROR_KINDS.HTTP,
          });
    }

    this.state.weather[location.key] = entry;
    this.forget(now);
    this.state.calls = this.client.calls;
    if (due.length > 0) {
      await this.store.save();
    }
    return { location, entry, errors, refreshed: due };
  }

  fetchPart(part, key) {
    const { api_key: apiKey, language } = this.config;
    switch (part) {
      case PARTS.CURRENT:
        return this.guard(() => this.client.currentConditions(apiKey, key, language));
      case PARTS.HOURLY:
        return this.guard(() => this.client.hourlyForecast(apiKey, key, language));
      case PARTS.DAILY:
        return this.guard(() => this.client.dailyForecast(apiKey, key, language));
      case PARTS.ALERTS:
        return this.guard(() => this.client.alerts(apiKey, key, language));
      default:
        throw new Error(`Unknown part ${part}`);
    }
  }

  /** Run a request, and stop asking for a while after a refusal that will repeat. */
  async guard(request) {
    try {
      return await request();
    } catch (err) {
      // Quota spent or key refused: every other request would be refused the
      // same way. Lifted after an hour, or at once by a new key (setConfig).
      if (err?.kind === ERROR_KINDS.QUOTA || err?.kind === ERROR_KINDS.AUTH) {
        this.blockedUntil = this.now() + QUOTA_BACKOFF_MS;
        this.lastError = { kind: err.kind, message: err.message, at: this.now() };
      }
      throw err;
    }
  }

  noteOutcome(errors) {
    const failure = errors.current;
    if (failure) {
      this.lastError = {
        kind: failure.kind ?? ERROR_KINDS.HTTP,
        message: failure.message,
        at: this.now(),
      };
      logger.warn(`AccuWeather refresh failed: ${failure.message}`);
      return;
    }
    for (const [part, err] of Object.entries(errors)) {
      logger.warn(`AccuWeather ${part} failed: ${err?.message ?? err}`);
    }
    this.lastError = null;
    this.lastSuccess = this.now();
  }

  assertNotBlocked() {
    if (this.now() < this.blockedUntil && this.lastError) {
      throw new AccuWeatherError(this.lastError.message, { kind: this.lastError.kind });
    }
  }

  forget(now) {
    for (const [key, entry] of Object.entries(this.state.weather)) {
      if (now - (entry.used ?? 0) > FORGET_AFTER_MS) {
        delete this.state.weather[key];
      }
    }
  }

  /** What the widgets and the test action say about the quota. */
  usage() {
    return {
      calls: this.client.callsLast24h(),
      remaining: this.client.remaining,
    };
  }
}

/** "Paris, Île-de-France" from an AccuWeather location. */
export function describeLocation(location) {
  const area = location?.AdministrativeArea?.LocalizedName;
  const name = location?.LocalizedName ?? location?.EnglishName ?? String(location?.Key ?? '');
  return area && area !== name ? `${name}, ${area}` : name;
}
