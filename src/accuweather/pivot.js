// -----------------------------------------------------------------------------
// AccuWeather answers -> the Gladys pivot weather format.
//
// The cache keeps the raw answers (metric forecasts, current conditions with
// both unit systems): the payload is built here for the unit system of each
// request, so a user in °F and another in °C cost the same calls.
//
// Pivot units: 'metric' = °C, m/s, hPa, mm, km; 'us' = °F, mph, inHg, in, mi.
// Percentages stay 0-100.
// -----------------------------------------------------------------------------

import { WEATHER_CONDITIONS, createLogger } from '@gladysassistant/integration-sdk';
import { alertTypeOf, conditionOf, severityOf } from './conditions.js';

const logger = createLogger({ name: 'pivot' });

export const UNITS = { METRIC: 'metric', US: 'us' };

const MAX_HOURS = 24;
const MAX_DAYS = 8;
const MAX_ALERTS = 10;
const MAX_EVENT_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

// --- Conversions -------------------------------------------------------------

export const celsiusToFahrenheit = (c) => (c * 9) / 5 + 32;
export const kmhToMs = (kmh) => kmh / 3.6;
export const kmhToMph = (kmh) => kmh / 1.609344;
export const mmToInches = (mm) => mm / 25.4;

/** Round to `digits` decimals, undefined for anything that is not a finite number. */
export function round(value, digits = 1) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

/** A metric temperature (°C) in the requested system. */
export function temperature(celsius, units) {
  const value = Number(celsius);
  if (celsius === null || celsius === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return round(units === UNITS.US ? celsiusToFahrenheit(value) : value);
}

/** A metric wind speed (km/h) in the requested system (m/s or mph). */
export function windSpeed(kmh, units) {
  const value = Number(kmh);
  if (kmh === null || kmh === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return round(units === UNITS.US ? kmhToMph(value) : kmhToMs(value));
}

/** A metric precipitation amount (mm) in the requested system. */
export function precipitation(mm, units) {
  const value = Number(mm);
  if (mm === null || mm === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return round(units === UNITS.US ? mmToInches(value) : value, 2);
}

/** A percentage, 0-100. */
function percent(value) {
  const number = round(value, 0);
  return number === undefined ? undefined : Math.min(100, Math.max(0, number));
}

/** Drop the undefined keys: Gladys drops them anyway, the tests read cleaner. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isoDate(value) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// --- Current conditions ------------------------------------------------------

/**
 * The current conditions in the requested system. AccuWeather already gives
 * both systems here; the wind is still converted, AccuWeather's metric wind is
 * in km/h and the pivot wants m/s.
 */
export function currentToPivot(current, units) {
  const us = units === UNITS.US;
  const pick = (measure) => measure?.[us ? 'Imperial' : 'Metric']?.Value;
  const windKmh = current?.Wind?.Speed?.Metric?.Value;
  const gustKmh = current?.WindGust?.Speed?.Metric?.Value;
  return compact({
    temperature: round(pick(current?.Temperature)),
    weather: conditionOf(current?.WeatherIcon),
    datetime: isoDate(current?.LocalObservationDateTime) ?? new Date().toISOString(),
    apparent_temperature: round(pick(current?.RealFeelTemperature)),
    humidity: percent(current?.RelativeHumidity),
    pressure: round(pick(current?.Pressure), us ? 2 : 0),
    dew_point: round(pick(current?.DewPoint)),
    wind_speed: windSpeed(windKmh, units),
    wind_direction: round(current?.Wind?.Direction?.Degrees, 0),
    wind_gust: windSpeed(gustKmh, units),
    visibility: round(pick(current?.Visibility)),
    cloud_cover: percent(current?.CloudCover),
    uv_index: round(current?.UVIndex, 0),
    is_day: typeof current?.IsDayTime === 'boolean' ? current.IsDayTime : undefined,
  });
}

// --- Forecasts ---------------------------------------------------------------

export function hourToPivot(hour, units) {
  return compact({
    temperature: temperature(hour?.Temperature?.Value, units),
    weather: conditionOf(hour?.WeatherIcon, hour?.PrecipitationIntensity),
    datetime: isoDate(hour?.DateTime),
    apparent_temperature: temperature(hour?.RealFeelTemperature?.Value, units),
    humidity: percent(hour?.RelativeHumidity),
    wind_speed: windSpeed(hour?.Wind?.Speed?.Value, units),
    wind_direction: round(hour?.Wind?.Direction?.Degrees, 0),
    wind_gust: windSpeed(hour?.WindGust?.Speed?.Value, units),
    cloud_cover: percent(hour?.CloudCover),
    precipitation: precipitation(hour?.TotalLiquid?.Value, units),
    precipitation_probability: percent(hour?.PrecipitationProbability),
    uv_index: round(hour?.UVIndex, 0),
    is_day: typeof hour?.IsDaylight === 'boolean' ? hour.IsDaylight : undefined,
  });
}

/** The UV index AccuWeather files under "AirAndPollen". */
function uvIndexOf(day) {
  const entry = (day?.AirAndPollen ?? []).find((item) => item?.Name === 'UVIndex');
  return round(entry?.Value, 0);
}

export function dayToPivot(day, units) {
  const liquid = [day?.Day?.TotalLiquid?.Value, day?.Night?.TotalLiquid?.Value]
    .map(Number)
    .filter(Number.isFinite);
  const probabilities = [day?.Day?.PrecipitationProbability, day?.Night?.PrecipitationProbability]
    .map(Number)
    .filter(Number.isFinite);
  return compact({
    temperature_min: temperature(day?.Temperature?.Minimum?.Value, units),
    temperature_max: temperature(day?.Temperature?.Maximum?.Value, units),
    datetime: isoDate(day?.Date),
    weather: day?.Day?.Icon ? conditionOf(day.Day.Icon) : undefined,
    humidity: percent(day?.Day?.RelativeHumidity?.Average),
    wind_speed: windSpeed(day?.Day?.Wind?.Speed?.Value, units),
    wind_direction: round(day?.Day?.Wind?.Direction?.Degrees, 0),
    wind_gust: windSpeed(day?.Day?.WindGust?.Speed?.Value, units),
    precipitation: liquid.length
      ? precipitation(
          liquid.reduce((sum, value) => sum + value, 0),
          units,
        )
      : undefined,
    precipitation_probability: probabilities.length
      ? percent(Math.max(...probabilities))
      : undefined,
    uv_index: uvIndexOf(day),
    sunrise: isoDate(day?.Sun?.Rise),
    sunset: isoDate(day?.Sun?.Set),
  });
}

// --- Alerts ------------------------------------------------------------------

/** A stable id for an alert: AccuWeather's when it gives one. */
export function alertId(alert) {
  const area = alert?.Area?.[0];
  return String(
    alert?.AlertID ??
      `${alert?.Description?.English ?? alert?.Category ?? 'alert'}:${area?.StartTime ?? ''}`,
  );
}

export function alertToPivot(alert) {
  const area = alert?.Area?.[0] ?? {};
  const event = String(
    alert?.Description?.Localized ?? alert?.Description?.English ?? alert?.Category ?? 'Alert',
  ).slice(0, MAX_EVENT_LENGTH);
  const description = String(area.Text ?? area.Summary ?? '').slice(0, MAX_DESCRIPTION_LENGTH);
  return compact({
    severity: severityOf(alert),
    event,
    type: alertTypeOf(alert),
    description: description || undefined,
    start: isoDate(area.StartTime),
    end: isoDate(area.EndTime),
  });
}

// --- The whole payload -------------------------------------------------------

/**
 * Build the pivot payload of one location.
 * @param {object} data cached raw answers `{ current, hourly, daily, alerts }`
 * @param {string} units 'metric' | 'us'
 */
export function toPivot(data, units) {
  if (!data?.current) {
    throw new Error('No current conditions to build the weather from');
  }
  const payload = currentToPivot(data.current, units);
  if (payload.temperature === undefined) {
    // The one required number: without it the core refuses the whole payload.
    throw new Error('AccuWeather sent current conditions without a temperature');
  }

  const days = (data.daily?.DailyForecasts ?? []).slice(0, MAX_DAYS);
  // Sunrise and sunset of the current conditions come from today's forecast.
  const today = days[0];
  if (today?.Sun) {
    payload.sunrise = isoDate(today.Sun.Rise);
    payload.sunset = isoDate(today.Sun.Set);
  }

  const hours = (data.hourly ?? [])
    .slice(0, MAX_HOURS)
    .map((hour) => hourToPivot(hour, units))
    .filter((hour) => hour.temperature !== undefined && hour.datetime);
  if (hours.length > 0) {
    payload.hours = hours;
  }

  const pivotDays = days
    .map((day) => dayToPivot(day, units))
    .filter(
      (day) =>
        day.temperature_min !== undefined && day.temperature_max !== undefined && day.datetime,
    );
  if (pivotDays.length > 0) {
    payload.days = pivotDays;
  }

  if (Array.isArray(data.alerts)) {
    payload.alerts = data.alerts.slice(0, MAX_ALERTS).map(alertToPivot);
  }

  if (payload.weather === WEATHER_CONDITIONS.UNKNOWN) {
    logger.debug(`Unknown AccuWeather icon ${data.current.WeatherIcon}`);
  }
  return payload;
}
