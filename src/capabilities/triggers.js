// -----------------------------------------------------------------------------
// Scene triggers (Gladys 5.1+): what CHANGED in the weather of the house.
//
// Declared in the manifest `scene_triggers`, fired after each refresh of the
// watched house (see index.js):
//
//   weather_alert      AccuWeather published a new severe weather alert.
//   condition_changed  the sky changed (clear -> rain, cloud -> snow...).
//   rain_expected      precipitation is forecast within the next 3 hours,
//                      where none was at the previous refresh.
//   frost_expected     a forecast night goes down to 0 °C or below.
//
// The doctrine of the core: one event per transition, never one per refresh.
// Each trigger remembers what it already said (in /data, so a restart does not
// say it again), and the very first reading after installation only sets that
// memory: an alert already running when the integration is installed is not
// news. Publishing never throws: a refused event must not fail the refresh.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  PRECIPITATION_CONDITIONS,
  currentConditionOf,
  hourConditionOf,
  precipitationTypeOf,
} from '../accuweather/conditions.js';
import { alertId, alertToPivot, round } from '../accuweather/pivot.js';

const logger = createLogger({ name: 'triggers' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  WEATHER_ALERT: 'weather_alert',
  CONDITION_CHANGED: 'condition_changed',
  RAIN_EXPECTED: 'rain_expected',
  FROST_EXPECTED: 'frost_expected',
};

/** How far ahead "rain expected" looks. */
export const RAIN_WINDOW_HOURS = 3;

/** A forecast probability from which an hour counts as wet. */
export const RAIN_PROBABILITY = 50;

/** "Frost": a forecast minimum at or below this, in °C. */
export const FROST_THRESHOLD_C = 0;

/** An alert not seen for this long is forgotten (and would fire again). */
const ALERT_MEMORY_MS = 48 * 60 * 60 * 1000;

/** The alert type a scene filters on when AccuWeather's matches none. */
export const OTHER_ALERT_TYPE = 'other';

/**
 * The first wet hour of the window, or null.
 * @param {Array<object>} hourly raw AccuWeather hours
 * @param {number} now
 */
export function firstWetHour(hourly, now) {
  const limit = now + RAIN_WINDOW_HOURS * 60 * 60 * 1000;
  for (const hour of hourly ?? []) {
    const time = new Date(hour?.DateTime).getTime();
    if (!Number.isFinite(time) || time > limit) {
      continue;
    }
    // The hour already started counts too: "it rains now" is the strongest
    // case of "rain expected".
    if (time + 60 * 60 * 1000 <= now) {
      continue;
    }
    const wet =
      hour?.HasPrecipitation === true ||
      Number(hour?.PrecipitationProbability) >= RAIN_PROBABILITY ||
      PRECIPITATION_CONDITIONS.has(hourConditionOf(hour));
    if (wet) {
      return { hour, time };
    }
  }
  return null;
}

/** The forecast days going down to the frost threshold: `[{ date, min }]`. */
export function frostDays(daily) {
  return (daily?.DailyForecasts ?? [])
    .map((day) => ({
      date: String(day?.Date ?? '').slice(0, 10),
      min: Number(day?.Temperature?.Minimum?.Value),
    }))
    .filter(({ date, min }) => date && Number.isFinite(min) && min <= FROST_THRESHOLD_C);
}

export class TriggerWatcher {
  /**
   * @param {object} options
   * @param {import('../accuweather/store.js').StateStore} options.store
   * @param {() => number} [options.now]
   */
  constructor({ store, now = () => Date.now() }) {
    this.store = store;
    this.now = now;
  }

  get memory() {
    this.store.state.triggers ??= {};
    return this.store.state.triggers;
  }

  /**
   * Compare a fresh reading with the last one and fire what changed.
   * @param {object} gladys the SDK instance
   * @param {{ location: object, entry: object }} weather the watched house
   * @returns {Promise<{ fired: string[], alertsChanged: boolean }>}
   */
  async evaluate(gladys, { location, entry }) {
    const memory = this.memory;
    const now = this.now();
    const place = location?.name ?? entry?.name ?? '';
    const events = [];

    // The memory belongs to one location: moving the house starts over.
    const baseline = !memory.initialized || memory.location !== location?.key;
    if (baseline) {
      memory.alerts = {};
      memory.active = [];
      memory.condition = null;
      memory.rain = false;
      memory.frost = [];
    }

    // --- Alerts: each AccuWeather alert id fires once.
    let alertsChanged = false;
    if (Array.isArray(entry.alerts)) {
      const seen = memory.alerts ?? {};
      const current = new Set();
      for (const alert of entry.alerts) {
        const id = alertId(alert);
        current.add(id);
        if (!(id in seen)) {
          alertsChanged = true;
          const pivot = alertToPivot(alert);
          events.push([
            SCENE_TRIGGERS.WEATHER_ALERT,
            {
              severity: pivot.severity,
              type: pivot.type ?? OTHER_ALERT_TYPE,
              event: pivot.event,
              description: (pivot.description ?? '').slice(0, 1000),
              starts_at: pivot.start ?? null,
              ends_at: pivot.end ?? null,
              location: place,
            },
          ]);
        }
        seen[id] = now;
      }
      // An alert gone since the last reading changes the core's list too.
      if ((memory.active ?? []).some((id) => !current.has(id))) {
        alertsChanged = true;
      }
      for (const [id, lastSeen] of Object.entries(seen)) {
        if (now - lastSeen > ALERT_MEMORY_MS) {
          delete seen[id];
        }
      }
      memory.alerts = seen;
      memory.active = [...current];
    }

    // --- Condition: the sky of the current conditions.
    const current = entry.current;
    if (current) {
      const condition = currentConditionOf(current);
      if (memory.condition && condition !== memory.condition) {
        events.push([
          SCENE_TRIGGERS.CONDITION_CHANGED,
          {
            condition,
            previous_condition: memory.condition,
            description: String(current.WeatherText ?? ''),
            temperature: round(current.Temperature?.Metric?.Value) ?? null,
            location: place,
          },
        ]);
      }
      memory.condition = condition;
    }

    // --- Rain: dry -> wet within the window.
    if (Array.isArray(entry.hourly)) {
      const wet = firstWetHour(entry.hourly, now);
      if (wet && !memory.rain) {
        events.push([
          SCENE_TRIGGERS.RAIN_EXPECTED,
          {
            precipitation_type: precipitationTypeOf(wet.hour.PrecipitationType),
            starts_at: new Date(wet.time).toISOString(),
            hours_until: Math.max(0, Math.round((wet.time - now) / (60 * 60 * 1000))),
            probability: round(wet.hour.PrecipitationProbability, 0) ?? null,
            location: place,
          },
        ]);
      }
      memory.rain = Boolean(wet);
    }

    // --- Frost: each forecast date fires once.
    if (entry.daily) {
      const announced = new Set(memory.frost ?? []);
      for (const { date, min } of frostDays(entry.daily)) {
        if (!announced.has(date)) {
          events.push([
            SCENE_TRIGGERS.FROST_EXPECTED,
            { date, temperature_min: round(min), location: place },
          ]);
          announced.add(date);
        }
      }
      // Only the dates still ahead are worth remembering.
      const today = new Date(now).toISOString().slice(0, 10);
      memory.frost = [...announced].filter((date) => date >= today).sort();
    }

    memory.initialized = true;
    memory.location = location?.key;
    await this.store.save();

    if (baseline) {
      logger.info(`Scene triggers armed for ${place || location?.key}`);
      return { fired: [], alertsChanged: false };
    }
    const fired = [];
    for (const [key, data] of events) {
      if (await publish(gladys, key, data)) {
        fired.push(key);
      }
    }
    return { fired, alertsChanged };
  }
}

async function publish(gladys, key, data) {
  try {
    await gladys.publishSceneEvent(key, data);
    logger.info(`Scene event ${key}: ${JSON.stringify(data)}`);
    return true;
  } catch (err) {
    // A core too old for scene triggers answers 404, a burst 429: neither may
    // cost the refresh the event came from.
    logger.warn(`Could not publish the scene event ${key}: ${err.message}`);
    return false;
  }
}
