// -----------------------------------------------------------------------------
// AccuWeather vocabulary -> Gladys pivot vocabulary.
//
// AccuWeather describes the sky with an icon number (1-44, night icons from 33)
// and alerts with a colour and a free-text category. Gladys wants one of the
// pivot conditions (`WEATHER_CONDITIONS`) and a CAP severity
// (`WEATHER_ALERT_SEVERITIES`). The tables below are the whole translation.
// -----------------------------------------------------------------------------

import {
  WEATHER_ALERT_SEVERITIES,
  WEATHER_ALERT_TYPES,
  WEATHER_CONDITIONS,
} from '@gladysassistant/integration-sdk';

const C = WEATHER_CONDITIONS;

/**
 * AccuWeather icon number -> pivot condition.
 * https://developer.accuweather.com/weather-icons
 * Night icons keep their meteorology: `is_day` carries the night.
 */
export const ICON_CONDITIONS = {
  1: C.CLEAR, // Sunny
  2: C.CLEAR, // Mostly sunny
  3: C.PARTLY_CLOUDY, // Partly sunny
  4: C.PARTLY_CLOUDY, // Intermittent clouds
  5: C.PARTLY_CLOUDY, // Hazy sunshine
  6: C.CLOUD, // Mostly cloudy
  7: C.CLOUD, // Cloudy
  8: C.CLOUD, // Dreary (overcast)
  11: C.FOG, // Fog
  12: C.RAIN, // Showers
  13: C.RAIN, // Mostly cloudy with showers
  14: C.RAIN, // Partly sunny with showers
  15: C.THUNDERSTORM, // Thunderstorms
  16: C.THUNDERSTORM, // Mostly cloudy with thunderstorms
  17: C.THUNDERSTORM, // Partly sunny with thunderstorms
  18: C.RAIN, // Rain
  19: C.SNOW, // Flurries
  20: C.SNOW, // Mostly cloudy with flurries
  21: C.SNOW, // Partly sunny with flurries
  22: C.SNOW, // Snow
  23: C.SNOW, // Mostly cloudy with snow
  24: C.SLEET, // Ice
  25: C.SLEET, // Sleet
  26: C.FREEZING_RAIN, // Freezing rain
  29: C.SLEET, // Rain and snow
  30: C.CLEAR, // Hot
  31: C.CLEAR, // Cold
  32: C.WIND, // Windy
  33: C.CLEAR, // Clear (night)
  34: C.CLEAR, // Mostly clear
  35: C.PARTLY_CLOUDY, // Partly cloudy
  36: C.PARTLY_CLOUDY, // Intermittent clouds
  37: C.PARTLY_CLOUDY, // Hazy moonlight
  38: C.CLOUD, // Mostly cloudy
  39: C.RAIN, // Partly cloudy with showers
  40: C.RAIN, // Mostly cloudy with showers
  41: C.THUNDERSTORM, // Partly cloudy with thunderstorms
  42: C.THUNDERSTORM, // Mostly cloudy with thunderstorms
  43: C.SNOW, // Mostly cloudy with flurries
  44: C.SNOW, // Mostly cloudy with snow
};

/**
 * The pivot condition of an AccuWeather icon. Heavy rain is "pouring": the
 * icon alone cannot tell, the hourly forecast gives an intensity.
 * @param {number} icon
 * @param {string} [intensity] `PrecipitationIntensity` ('Light' | 'Moderate' | 'Heavy')
 */
export function conditionOf(icon, intensity) {
  const condition = ICON_CONDITIONS[Number(icon)] ?? C.UNKNOWN;
  if (condition === C.RAIN && /heavy/i.test(String(intensity ?? ''))) {
    return C.POURING;
  }
  return condition;
}

/** Conditions that wet the ground: what "rain expected" watches. */
export const PRECIPITATION_CONDITIONS = new Set([
  C.DRIZZLE,
  C.RAIN,
  C.POURING,
  C.SLEET,
  C.HAIL,
  C.SNOW,
  C.THUNDERSTORM,
  C.FREEZING_RAIN,
  C.SNOW_THUNDERSTORM,
]);

/** AccuWeather `PrecipitationType` -> the scene trigger filter value. */
export const PRECIPITATION_TYPES = {
  RAIN: 'rain',
  SNOW: 'snow',
  ICE: 'ice',
  MIXED: 'mixed',
};

export function precipitationTypeOf(value) {
  const text = String(value ?? '').toLowerCase();
  if (text.includes('snow')) {
    return PRECIPITATION_TYPES.SNOW;
  }
  if (text.includes('ice')) {
    return PRECIPITATION_TYPES.ICE;
  }
  if (text.includes('mixed')) {
    return PRECIPITATION_TYPES.MIXED;
  }
  return PRECIPITATION_TYPES.RAIN;
}

const S = WEATHER_ALERT_SEVERITIES;

/**
 * CAP severity of an AccuWeather alert. European alerts (MeteoAlarm, Météo
 * France, DWD...) come with the awareness colour; US alerts (NWS) with a level
 * name. Unknown -> moderate: an alert nobody can grade is still an alert.
 */
export function severityOf(alert) {
  const colour = String(alert?.Color?.Name ?? alert?.Level ?? '').toLowerCase();
  if (colour.includes('red') || colour.includes('purple')) {
    return S.EXTREME;
  }
  if (colour.includes('orange')) {
    return S.SEVERE;
  }
  if (colour.includes('yellow')) {
    return S.MODERATE;
  }
  if (colour.includes('green')) {
    return S.MINOR;
  }
  const level = `${alert?.Level ?? ''} ${alert?.Description?.English ?? ''}`.toLowerCase();
  if (level.includes('emergency') || level.includes('extreme')) {
    return S.EXTREME;
  }
  if (level.includes('warning')) {
    return S.SEVERE;
  }
  if (level.includes('advisory') || level.includes('statement')) {
    return S.MINOR;
  }
  return S.MODERATE;
}

const T = WEATHER_ALERT_TYPES;

/** Keywords of AccuWeather categories and alert names, first match wins. */
const ALERT_TYPE_KEYWORDS = [
  [/avalanche/, T.AVALANCHE],
  [/thunder|lightning|orage/, T.THUNDERSTORM],
  [/flood|inondation/, T.FLOOD],
  [/coast|surf|tide|marine|wave|submersion/, T.COASTAL],
  // Before wind: a "winter storm" is snow, not wind.
  [/snow|\bice\b|blizzard|winter|frost|freez|verglas|neige/, T.SNOW],
  [/heat|canicule|\bhot\b/, T.HEAT],
  [/cold|chill|froid/, T.COLD],
  [/fog|brouillard/, T.FOG],
  [/wind|gale|storm|hurricane|tornado|\bvent\b/, T.WIND],
  [/rain|pluie|precipitation/, T.RAIN],
];

/** Phenomenon type of an alert, undefined when nothing matches. */
export function alertTypeOf(alert) {
  const text = [alert?.Category, alert?.Type, alert?.Description?.English]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return ALERT_TYPE_KEYWORDS.find(([pattern]) => pattern.test(text))?.[1];
}

/** The pivot severities from the mildest to the worst: comparisons use the index. */
export const SEVERITY_ORDER = [S.MINOR, S.MODERATE, S.SEVERE, S.EXTREME];
