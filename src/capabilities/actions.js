// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
//   test_connection  check the API key and the location, say what a day costs
//   refresh_now      refresh the weather of the house now
//
// Each handler resolves the multi-language message shown under the button.
// Throwing shows the error instead, so failures the user can fix are answered
// with a message saying how, not thrown.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from '../accuweather/client.js';
import { describeLocation } from '../accuweather/service.js';
import { isConfigured } from '../config.js';
import { localize, pick } from '../i18n.js';

/** Keys of the manifest `actions`. Never renamed. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  REFRESH_NOW: 'refresh_now',
};

/** Requests a day at the configured pace, as the docs compute it. */
export function dailyBudget(config) {
  const refreshes = Math.ceil((24 * 60) / config.refresh_minutes);
  const daily = Math.ceil((24 * 60) / Math.max(config.refresh_minutes, 180));
  return refreshes * (1 + (config.hourly_forecast ? 1 : 0) + (config.alerts ? 1 : 0)) + daily;
}

/** What to tell the user about a failed request, per kind of failure. */
export function explainError(err) {
  switch (err?.kind) {
    case ERROR_KINDS.AUTH:
      return {
        en: 'AccuWeather refused the API key: copy it again from developer.accuweather.com.',
        fr: "AccuWeather refuse la clé d'API : recopiez-la depuis developer.accuweather.com.",
        de: 'AccuWeather lehnt den API-Schlüssel ab: Kopiere ihn erneut von developer.accuweather.com.',
        es: 'AccuWeather rechaza la clave de API: cópiela de nuevo desde developer.accuweather.com.',
      };
    case ERROR_KINDS.QUOTA:
      return {
        en: 'The daily AccuWeather quota is spent: raise the refresh interval, it comes back within 24 hours.',
        fr: "Le quota quotidien AccuWeather est épuisé : augmentez l'intervalle de rafraîchissement, il revient sous 24 heures.",
        de: 'Das tägliche AccuWeather-Kontingent ist aufgebraucht: Erhöhe das Aktualisierungsintervall, es erneuert sich innerhalb von 24 Stunden.',
        es: 'La cuota diaria de AccuWeather está agotada: aumente el intervalo de actualización, se renueva en 24 horas.',
      };
    case ERROR_KINDS.FORBIDDEN:
      return {
        en: 'Your AccuWeather plan does not include this data.',
        fr: "Votre offre AccuWeather n'inclut pas ces données.",
        de: 'Dein AccuWeather-Tarif enthält diese Daten nicht.',
        es: 'Su plan de AccuWeather no incluye estos datos.',
      };
    case ERROR_KINDS.NOT_FOUND:
      return {
        en: 'AccuWeather does not know this location: check the location key, or leave it empty.',
        fr: 'AccuWeather ne connaît pas ce lieu : vérifiez la clé de lieu, ou laissez-la vide.',
        de: 'AccuWeather kennt diesen Ort nicht: Prüfe den Ortsschlüssel oder lass ihn leer.',
        es: 'AccuWeather no conoce esta ubicación: compruebe la clave de ubicación o déjela vacía.',
      };
    case ERROR_KINDS.NETWORK:
      return {
        en: 'AccuWeather could not be reached: check the Internet access of Gladys.',
        fr: "AccuWeather est injoignable : vérifiez l'accès Internet de Gladys.",
        de: 'AccuWeather ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
        es: 'No se puede contactar con AccuWeather: compruebe el acceso a Internet de Gladys.',
      };
    default:
      return localize(
        (language) =>
          `${pick(language, {
            en: 'AccuWeather error',
            fr: 'Erreur AccuWeather',
            de: 'AccuWeather-Fehler',
            es: 'Error de AccuWeather',
          })}: ${err?.message ?? err}`,
      );
  }
}

/** What a manual refresh says: done, or nothing done (5-minute floor). */
export function refreshMessage(weather) {
  return weather.refreshed.length > 0
    ? {
        en: 'Weather refreshed.',
        fr: 'Météo actualisée.',
        de: 'Wetter aktualisiert.',
        es: 'Tiempo actualizado.',
      }
    : {
        en: 'Already up to date (one refresh every 5 minutes at most).',
        fr: 'Déjà à jour (un rafraîchissement toutes les 5 minutes au plus).',
        de: 'Bereits aktuell (höchstens eine Aktualisierung alle 5 Minuten).',
        es: 'Ya actualizado (como mucho una actualización cada 5 minutos).',
      };
}

const NOT_CONFIGURED = {
  en: 'No API key yet: create one on developer.accuweather.com, paste it above and save.',
  fr: "Pas encore de clé d'API : créez-en une sur developer.accuweather.com, collez-la ci-dessus et enregistrez.",
  de: 'Noch kein API-Schlüssel: Erstelle einen auf developer.accuweather.com, füge ihn oben ein und speichere.',
  es: 'Aún no hay clave de API: cree una en developer.accuweather.com, péguela arriba y guarde.',
};

export const NO_HOUSE = {
  en: 'The key works, but Gladys has no located house: set its position in Settings > Houses.',
  fr: "La clé fonctionne, mais Gladys n'a aucune maison localisée : renseignez sa position dans Paramètres > Maisons.",
  de: 'Der Schlüssel funktioniert, aber Gladys hat kein Haus mit Position: Lege sie unter Einstellungen > Häuser fest.',
  es: 'La clave funciona, pero Gladys no tiene ninguna casa ubicada: indique su posición en Ajustes > Casas.',
};

/**
 * @param {object} deps
 * @param {import('../accuweather/service.js').WeatherService} deps.service
 * @param {import('../accuweather/client.js').AccuWeatherClient} deps.client
 */
export function buildActions({ service, client }) {
  return {
    async [ACTIONS.TEST_CONNECTION]() {
      const { config } = service;
      if (!isConfigured(config)) {
        return NOT_CONFIGURED;
      }
      try {
        if (config.location_key) {
          // Checked once by a real request: the name is kept for the widgets.
          const found = await client.location(config.api_key, config.location_key, config.language);
          service.state.locations.manual = {
            key: String(found.Key),
            name: describeLocation(found),
          };
          await service.store.save();
        }
        const weather = await service.homeWeather({ force: true });
        if (!weather) {
          return NO_HOUSE;
        }
        const { location, entry } = weather;
        const temperatureC = entry.current?.Temperature?.Metric?.Value;
        const { calls } = service.usage();
        const budget = dailyBudget(config);
        return localize((language) =>
          pick(language, {
            en: `Connected. ${location.name} (key ${location.key}): ${entry.current?.WeatherText ?? ''}, ${temperatureC} °C. ${calls} request(s) over the last 24 h; about ${budget} a day at this refresh interval.`,
            fr: `Connecté. ${location.name} (clé ${location.key}) : ${entry.current?.WeatherText ?? ''}, ${temperatureC} °C. ${calls} requête(s) ces dernières 24 h ; environ ${budget} par jour à cet intervalle.`,
            de: `Verbunden. ${location.name} (Schlüssel ${location.key}): ${entry.current?.WeatherText ?? ''}, ${temperatureC} °C. ${calls} Anfrage(n) in den letzten 24 Std.; etwa ${budget} pro Tag bei diesem Intervall.`,
            es: `Conectado. ${location.name} (clave ${location.key}): ${entry.current?.WeatherText ?? ''}, ${temperatureC} °C. ${calls} petición(es) en las últimas 24 h; unas ${budget} al día con este intervalo.`,
          }),
        );
      } catch (err) {
        return explainError(err);
      }
    },

    async [ACTIONS.REFRESH_NOW]() {
      if (!isConfigured(service.config)) {
        return NOT_CONFIGURED;
      }
      try {
        const weather = await service.homeWeather({ force: true });
        if (!weather) {
          return NO_HOUSE;
        }
        return refreshMessage(weather);
      } catch (err) {
        return explainError(err);
      }
    },
  };
}
