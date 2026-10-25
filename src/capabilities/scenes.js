// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+): the weather of the house, readable in a scene.
//
// Declared in the manifest `scene_actions`:
//
//   get_forecast            today's, tomorrow's or the day after's forecast
//   get_current_conditions  the weather right now
//   refresh_weather         ask AccuWeather now instead of at the next refresh
//
// The two readers serve the cache (no AccuWeather request unless it is older
// than the refresh interval): a scene running every morning costs nothing. A
// scene action is never a condition: they return outputs ("rain_expected",
// "temperature_max"...) and the scene author gates the next actions on them.
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS, createLogger } from '@gladysassistant/integration-sdk';
import { dayConditionOf } from '../accuweather/conditions.js';
import { UNITS, currentToPivot, dayToPivot } from '../accuweather/pivot.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_actions`. Never renamed: scenes store them. */
export const SCENE_ACTIONS = {
  GET_FORECAST: 'get_forecast',
  GET_CURRENT_CONDITIONS: 'get_current_conditions',
  REFRESH_WEATHER: 'refresh_weather',
};

/** The `day` field of get_forecast: an index in the 5-day forecast. */
export const FORECAST_DAYS = { today: 0, tomorrow: 1, day_after: 2 };

function unitsOf(fields) {
  return fields?.units === UNITS.US ? UNITS.US : UNITS.METRIC;
}

async function homeWeather(service, options) {
  const weather = await service.homeWeather(options);
  if (!weather) {
    throw new Error('No located house in Gladys: set the position of your house first');
  }
  return weather;
}

/**
 * The scene action handlers, keyed by their manifest key. Each one receives
 * the RESOLVED fields and resolves the declared outputs (scalars only).
 * @param {import('../accuweather/service.js').WeatherService} service
 */
export function buildSceneActions(service) {
  return {
    async [SCENE_ACTIONS.GET_FORECAST](fields) {
      const units = unitsOf(fields);
      const index = FORECAST_DAYS[fields?.day] ?? FORECAST_DAYS.today;
      const { entry } = await homeWeather(service);
      const day = entry.daily?.DailyForecasts?.[index];
      if (!day) {
        throw new Error('No forecast for that day yet');
      }
      const pivot = dayToPivot(day, units);
      logger.info(`Scene action get_forecast <- ${fields?.day ?? 'today'}`);
      return {
        condition: dayConditionOf(day) ?? WEATHER_CONDITIONS.UNKNOWN,
        description: String(day.Day?.IconPhrase ?? ''),
        temperature_min: pivot.temperature_min ?? null,
        temperature_max: pivot.temperature_max ?? null,
        precipitation_probability: pivot.precipitation_probability ?? 0,
        rain_expected: day.Day?.HasPrecipitation === true || day.Night?.HasPrecipitation === true,
        wind_speed: pivot.wind_speed ?? null,
        uv_index: pivot.uv_index ?? null,
      };
    },

    async [SCENE_ACTIONS.GET_CURRENT_CONDITIONS](fields) {
      const units = unitsOf(fields);
      const { entry } = await homeWeather(service);
      const pivot = currentToPivot(entry.current, units);
      logger.info('Scene action get_current_conditions');
      return {
        condition: pivot.weather,
        description: String(entry.current.WeatherText ?? ''),
        temperature: pivot.temperature ?? null,
        apparent_temperature: pivot.apparent_temperature ?? null,
        humidity: pivot.humidity ?? null,
        wind_speed: pivot.wind_speed ?? null,
        uv_index: pivot.uv_index ?? null,
        is_day: pivot.is_day ?? true,
      };
    },

    async [SCENE_ACTIONS.REFRESH_WEATHER]() {
      const { refreshed } = await homeWeather(service, { force: true });
      logger.info(`Scene action refresh_weather -> ${refreshed.join(', ') || 'nothing due'}`);
      return {
        refreshed: refreshed.length > 0,
        calls_last_24h: service.usage().calls,
      };
    },
  };
}
