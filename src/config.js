// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object, so the rest of the code never deals with
// `undefined`, a number typed as a string or an out-of-range value.
// -----------------------------------------------------------------------------

/** The languages AccuWeather is asked to write its texts in (alerts, phrases). */
export const API_LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * Refresh interval bounds, in minutes. AccuWeather counts every request
 * against a daily quota (50 a day on the oldest free keys): one refresh costs
 * up to four requests, so a refresh every 30 minutes is the fastest pace a
 * paid key can afford, and the default stays under 50 requests a day.
 */
export const MIN_REFRESH_MINUTES = 30;
export const MAX_REFRESH_MINUTES = 1440;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  api_key: '',
  language: 'en',
  refresh_minutes: 120,
  hourly_forecast: true,
  alerts: true,
  location_key: '',
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    // Pasted keys often carry a trailing space or newline.
    api_key: String(source.api_key ?? '').trim(),
    language: API_LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
    refresh_minutes: clampMinutes(source.refresh_minutes),
    // A form may send booleans as strings: only an explicit false turns a fetch off.
    hourly_forecast: source.hourly_forecast !== false && source.hourly_forecast !== 'false',
    alerts: source.alerts !== false && source.alerts !== 'false',
    // AccuWeather location keys are digits (a city) or "lat,lon"-free ids such
    // as "623_PC": keep letters, digits and underscores only.
    location_key: String(source.location_key ?? '')
      .trim()
      .replace(/[^0-9A-Za-z_]/g, ''),
  };
}

function clampMinutes(value) {
  const minutes = Math.round(Number(value));
  if (value === undefined || value === null || value === '' || !Number.isFinite(minutes)) {
    return DEFAULT_CONFIG.refresh_minutes;
  }
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, minutes));
}

/** Whether the integration can call AccuWeather at all. */
export function isConfigured(config) {
  return config.api_key.length > 0;
}

/**
 * The secret API key, shortened for logs and messages: never log it in full.
 * @param {string} key
 */
export function maskKey(key) {
  const value = String(key ?? '');
  if (value.length <= 8) {
    return value ? '****' : '';
  }
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}
