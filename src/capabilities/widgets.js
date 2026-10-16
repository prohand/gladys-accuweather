// -----------------------------------------------------------------------------
// Dashboard widgets (Gladys 5.1+): the weather of the house, AccuWeather style.
//
// Gladys already draws its own weather widget from the pivot payload
// (onWeatherGet). These two show what it does not:
//
//   accuweather_now       the conditions now (feels-like, wind, UV), the next
//                         12 hours as a curve, the alerts, the rain to come and
//                         how many AccuWeather requests the day cost.
//   accuweather_forecast  the next 5 days, with AccuWeather's own words.
//
// Both read the cache (no request unless it is older than the refresh
// interval), and index.js nudges them after every refresh. The content is
// declarative: the core renders it with its theme, dark mode and language.
// Budget (SDK README): at most 8 components, 1 focal (chart | card-list),
// 6 tiles, 2 texts, 1 status, 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, WEATHER_CONDITIONS, createLogger } from '@gladysassistant/integration-sdk';
import { SEVERITY_ORDER, conditionOf } from '../accuweather/conditions.js';
import { UNITS, alertToPivot, round, temperature } from '../accuweather/pivot.js';
import { isConfigured } from '../config.js';
import { refreshMessage } from './actions.js';
import { localize, pick } from '../i18n.js';
import { firstWetHour } from './triggers.js';

const logger = createLogger({ name: 'widgets' });

/** Keys of the manifest `widgets`. Never renamed: dashboards store them. */
export const WIDGET_KEYS = {
  NOW: 'accuweather_now',
  FORECAST: 'accuweather_forecast',
};

/** The one widget action: refresh now. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

/** Days the forecast widget shows when its settings say nothing. */
export const DEFAULT_FORECAST_DAYS = 5;

const C = WEATHER_CONDITIONS;

/** Short names of the conditions (badges hold 16 characters). */
export const CONDITION_LABELS = {
  [C.CLEAR]: { en: 'Clear', fr: 'Dégagé', de: 'Klar', es: 'Despejado' },
  [C.PARTLY_CLOUDY]: {
    en: 'Partly cloudy',
    fr: 'Éclaircies',
    de: 'Teils bewölkt',
    es: 'Algo nublado',
  },
  [C.CLOUD]: { en: 'Cloudy', fr: 'Nuageux', de: 'Bewölkt', es: 'Nublado' },
  [C.FOG]: { en: 'Fog', fr: 'Brouillard', de: 'Nebel', es: 'Niebla' },
  [C.DRIZZLE]: { en: 'Drizzle', fr: 'Bruine', de: 'Nieselregen', es: 'Llovizna' },
  [C.RAIN]: { en: 'Rain', fr: 'Pluie', de: 'Regen', es: 'Lluvia' },
  [C.POURING]: { en: 'Heavy rain', fr: 'Forte pluie', de: 'Starkregen', es: 'Lluvia fuerte' },
  [C.SLEET]: { en: 'Sleet', fr: 'Neige fondue', de: 'Schneeregen', es: 'Aguanieve' },
  [C.HAIL]: { en: 'Hail', fr: 'Grêle', de: 'Hagel', es: 'Granizo' },
  [C.SNOW]: { en: 'Snow', fr: 'Neige', de: 'Schnee', es: 'Nieve' },
  [C.THUNDERSTORM]: { en: 'Thunderstorm', fr: 'Orage', de: 'Gewitter', es: 'Tormenta' },
  [C.WIND]: { en: 'Windy', fr: 'Venteux', de: 'Windig', es: 'Ventoso' },
  [C.FREEZING_RAIN]: {
    en: 'Freezing rain',
    fr: 'Verglas',
    de: 'Glatteisregen',
    es: 'Lluvia helada',
  },
  [C.UNKNOWN]: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

const CONDITION_COLORS = {
  [C.CLEAR]: WIDGET_COLORS.SUCCESS,
  [C.PARTLY_CLOUDY]: WIDGET_COLORS.INFO,
  [C.RAIN]: WIDGET_COLORS.PRIMARY,
  [C.POURING]: WIDGET_COLORS.PRIMARY,
  [C.DRIZZLE]: WIDGET_COLORS.PRIMARY,
  [C.THUNDERSTORM]: WIDGET_COLORS.WARNING,
  [C.WIND]: WIDGET_COLORS.WARNING,
  [C.FREEZING_RAIN]: WIDGET_COLORS.DANGER,
};

const SEVERITY_COLORS = {
  minor: WIDGET_COLORS.INFO,
  moderate: WIDGET_COLORS.WARNING,
  severe: WIDGET_COLORS.DANGER,
  extreme: WIDGET_COLORS.DANGER,
};

function clip(text, length) {
  const value = String(text ?? '');
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

/** "14:25" from AccuWeather's local "2026-10-16T14:25:00+02:00": the house's own clock. */
function localTime(value) {
  return String(value ?? '').match(/T(\d{2}:\d{2})/)?.[1] ?? '';
}

/** "Fri 17 Oct" in the reader's language, from AccuWeather's local date. */
export function dayName(value, language) {
  const [year, month, day] = String(value ?? '')
    .slice(0, 10)
    .split('-')
    .map(Number);
  if (!year || !month || !day) {
    return '';
  }
  try {
    return new Intl.DateTimeFormat(language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  } catch {
    return String(value).slice(0, 10);
  }
}

/** A widget with nothing to show yet: say why, in one body text. */
function notice(text) {
  return { ttl_seconds: 60, components: [{ type: 'text', variant: 'body', text }] };
}

const NOT_CONFIGURED = {
  en: 'Paste your AccuWeather API key in the configuration of the integration.',
  fr: "Collez votre clé d'API AccuWeather dans la configuration de l'intégration.",
  de: 'Füge deinen AccuWeather-API-Schlüssel in der Konfiguration der Integration ein.',
  es: 'Pegue su clave de API de AccuWeather en la configuración de la integración.',
};

const NO_HOUSE = {
  en: 'Set the position of your house in Gladys (Settings > Houses).',
  fr: 'Renseignez la position de votre maison dans Gladys (Paramètres > Maisons).',
  de: 'Lege die Position deines Hauses in Gladys fest (Einstellungen > Häuser).',
  es: 'Indique la ubicación de su casa en Gladys (Ajustes > Casas).',
};

/** The cached weather of the house, refreshed when due, or a notice content. */
async function readHome(service) {
  if (!isConfigured(service.config)) {
    return { content: notice(NOT_CONFIGURED) };
  }
  if (!service.home) {
    return { content: notice(NO_HOUSE) };
  }
  try {
    return { weather: await service.homeWeather() };
  } catch (err) {
    logger.warn(`Widget without weather: ${err.message}`);
    return {
      content: notice(
        localize((language) =>
          clip(
            `${pick(language, {
              en: 'AccuWeather did not answer',
              fr: "AccuWeather n'a pas répondu",
              de: 'AccuWeather hat nicht geantwortet',
              es: 'AccuWeather no respondió',
            })}: ${err.message}`,
            300,
          ),
        ),
      ),
    };
  }
}

// --- accuweather_now ---------------------------------------------------------

function alertItem(entry) {
  const label = { en: 'Alerts', fr: 'Alertes', de: 'Warnungen', es: 'Alertas' };
  if (!Array.isArray(entry.alerts)) {
    return null;
  }
  if (entry.alerts.length === 0) {
    return {
      label,
      icon: 'shield',
      value: { en: 'none', fr: 'aucune', de: 'keine', es: 'ninguna' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  const alerts = entry.alerts.map(alertToPivot);
  const worst = alerts.reduce((a, b) =>
    SEVERITY_ORDER.indexOf(b.severity) > SEVERITY_ORDER.indexOf(a.severity) ? b : a,
  );
  const more = alerts.length > 1 ? ` (+${alerts.length - 1})` : '';
  return {
    label,
    icon: 'alert-triangle',
    value: clip(`${worst.event}${more}`, 40),
    color: SEVERITY_COLORS[worst.severity] ?? WIDGET_COLORS.WARNING,
  };
}

function rainItem(entry, now) {
  if (!Array.isArray(entry.hourly)) {
    return null;
  }
  const label = {
    en: 'Rain within 3 h',
    fr: 'Pluie sous 3 h',
    de: 'Regen in 3 Std.',
    es: 'Lluvia en 3 h',
  };
  const wet = firstWetHour(entry.hourly, now);
  if (!wet) {
    return {
      label,
      icon: 'umbrella',
      value: { en: 'no', fr: 'non', de: 'nein', es: 'no' },
      color: WIDGET_COLORS.SUCCESS,
    };
  }
  const at = localTime(wet.hour.DateTime);
  return {
    label,
    icon: 'umbrella',
    value: localize((language) =>
      pick(language, {
        en: `from ${at}`,
        fr: `dès ${at}`,
        de: `ab ${at}`,
        es: `desde las ${at}`,
      }),
    ),
    color: WIDGET_COLORS.PRIMARY,
  };
}

function usageItem(service) {
  const { calls, remaining } = service.usage();
  return {
    label: {
      en: 'Requests (24 h)',
      fr: 'Requêtes (24 h)',
      de: 'Anfragen (24 Std.)',
      es: 'Peticiones (24 h)',
    },
    icon: 'activity',
    // AccuWeather says what is left only on some plans (RateLimit-Remaining).
    value:
      remaining === null
        ? calls
        : {
            en: `${calls} · ${remaining} left`,
            fr: `${calls} · ${remaining} restantes`,
            de: `${calls} · ${remaining} übrig`,
            es: `${calls} · ${remaining} restantes`,
          },
    color: service.lastError ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
  };
}

export async function buildNowWidget(service, { language = 'en', units = UNITS.METRIC } = {}) {
  const { weather, content } = await readHome(service);
  if (content) {
    return content;
  }
  const { location, entry } = weather;
  const current = entry.current;
  const us = units === UNITS.US;
  const system = us ? 'Imperial' : 'Metric';
  const condition = conditionOf(current.WeatherIcon);
  const components = [];

  components.push({
    type: 'text',
    variant: 'heading',
    text: clip(
      `${location?.name ?? entry.name ?? ''} · ${current.WeatherText ?? pick(language, CONDITION_LABELS[condition])}`,
      40,
    ),
  });

  const tile = (label, value, unit, icon, color) =>
    value === undefined || value === null
      ? null
      : {
          type: 'value',
          label,
          value,
          ...(unit ? { unit } : {}),
          icon,
          ...(color ? { color } : {}),
        };
  components.push(
    ...[
      tile(
        { en: 'Temperature', fr: 'Température', de: 'Temperatur', es: 'Temperatura' },
        round(current.Temperature?.[system]?.Value),
        us ? '°F' : '°C',
        'thermometer',
        CONDITION_COLORS[condition],
      ),
      tile(
        { en: 'Feels like', fr: 'Ressenti', de: 'Gefühlt', es: 'Sensación' },
        round(current.RealFeelTemperature?.[system]?.Value),
        us ? '°F' : '°C',
        'user',
      ),
      tile(
        { en: 'Humidity', fr: 'Humidité', de: 'Feuchte', es: 'Humedad' },
        round(current.RelativeHumidity, 0),
        '%',
        'droplet',
      ),
      tile(
        { en: 'Wind', fr: 'Vent', de: 'Wind', es: 'Viento' },
        round(current.Wind?.Speed?.[system]?.Value, 0),
        us ? 'mph' : 'km/h',
        'wind',
      ),
    ].filter(Boolean),
  );

  // The next hours as a curve: the one thing the core weather widget lacks.
  const points = (entry.hourly ?? [])
    .map((hour) => ({
      t: new Date(hour.DateTime).toISOString(),
      v: temperature(hour.Temperature?.Value, units),
    }))
    .filter((point) => point.v !== undefined);
  if (points.length >= 2) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: {
        en: 'Next 12 hours',
        fr: '12 prochaines heures',
        de: 'Nächste 12 Stunden',
        es: 'Próximas 12 horas',
      },
      unit: us ? '°F' : '°C',
      series: [
        {
          name: pick(language, {
            en: 'Temperature',
            fr: 'Température',
            de: 'Temperatur',
            es: 'Temperatura',
          }),
          points,
        },
      ],
    });
  }

  const now = service.now();
  components.push({
    type: 'status',
    items: [
      alertItem(entry),
      rainItem(entry, now),
      {
        label: { en: 'Observed at', fr: 'Observé à', de: 'Beobachtet um', es: 'Observado a las' },
        icon: 'clock',
        value: localTime(current.LocalObservationDateTime) || '—',
        color: service.lastError ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
      usageItem(service),
    ].filter(Boolean),
  });

  components.push({
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });
  if (/^https:\/\//.test(current.Link ?? '') && components.length < 8) {
    components.push({
      type: 'button',
      label: 'AccuWeather',
      icon: 'external-link',
      style: 'secondary',
      link: { url: current.Link },
    });
  }

  return { ttl_seconds: 600, components };
}

// --- accuweather_forecast ----------------------------------------------------

function daysShown(settings) {
  const raw = settings?.days;
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_FORECAST_DAYS;
  }
  const number = Math.trunc(Number(raw));
  return Number.isFinite(number) ? Math.max(1, Math.min(5, number)) : DEFAULT_FORECAST_DAYS;
}

export async function buildForecastWidget(
  service,
  { settings = {}, language = 'en', units = UNITS.METRIC } = {},
) {
  const { weather, content } = await readHome(service);
  if (content) {
    return content;
  }
  const { entry } = weather;
  const days = (entry.daily?.DailyForecasts ?? []).slice(0, daysShown(settings));
  const degree = units === UNITS.US ? '°F' : '°C';
  const components = [];

  const headline = entry.daily?.Headline?.Text;
  if (headline) {
    components.push({ type: 'text', variant: 'caption', text: clip(headline, 80) });
  }

  if (days.length === 0) {
    components.push({
      type: 'text',
      variant: 'body',
      text: {
        en: 'No forecast yet: it comes with the next refresh.',
        fr: 'Pas encore de prévisions : elles arrivent au prochain rafraîchissement.',
        de: 'Noch keine Vorhersage: Sie kommt mit der nächsten Aktualisierung.',
        es: 'Aún no hay previsión: llegará con la próxima actualización.',
      },
    });
    return { ttl_seconds: 300, components };
  }

  components.push({
    type: 'card-list',
    display: 'list',
    items: days.map((day) => {
      const condition = conditionOf(day.Day?.Icon);
      const min = temperature(day.Temperature?.Minimum?.Value, units);
      const max = temperature(day.Temperature?.Maximum?.Value, units);
      const rain = Math.max(
        Number(day.Day?.PrecipitationProbability) || 0,
        Number(day.Night?.PrecipitationProbability) || 0,
      );
      return {
        title: clip(dayName(day.Date, language), 60),
        subtitle: `${min ?? '–'}${degree} / ${max ?? '–'}${degree} · ${rain} %`,
        badge: {
          text: localize((lang) => clip(pick(lang, CONDITION_LABELS[condition]), 16)),
          color: CONDITION_COLORS[condition] ?? WIDGET_COLORS.NEUTRAL,
        },
        description: localize((lang) =>
          clip(
            [
              `${pick(lang, { en: 'Day', fr: 'Jour', de: 'Tag', es: 'Día' })}: ${day.Day?.IconPhrase ?? '–'}`,
              `${pick(lang, { en: 'Night', fr: 'Nuit', de: 'Nacht', es: 'Noche' })}: ${day.Night?.IconPhrase ?? '–'}`,
            ].join('\n'),
            2000,
          ),
        ),
        ...(/^https:\/\//.test(day.Link ?? '')
          ? { links: [{ url: day.Link, label: 'AccuWeather' }] }
          : {}),
      };
    }),
  });

  components.push({
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.REFRESH },
  });

  return { ttl_seconds: 1800, components };
}

// --- Registry ----------------------------------------------------------------

/**
 * The widget handlers, keyed by their manifest key: `get` is registered with
 * `gladys.onWidgetGet`, `action` with `gladys.onWidgetAction`.
 * @param {import('../accuweather/service.js').WeatherService} service
 */
export function buildWidgets(service) {
  const action = async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    const weather = await service.homeWeather({ force: true });
    if (!weather) {
      return NO_HOUSE;
    }
    return refreshMessage(weather);
  };
  return {
    [WIDGET_KEYS.NOW]: {
      get: (request) => buildNowWidget(service, request),
      action,
    },
    [WIDGET_KEYS.FORECAST]: {
      get: (request) => buildForecastWidget(service, request),
      action,
    },
  };
}

/** Nudge every widget: the core re-pulls them now instead of at their TTL. */
export function refreshWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    gladys.requestWidgetRefresh(key);
  }
}
