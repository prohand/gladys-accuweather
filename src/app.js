// -----------------------------------------------------------------------------
// The integration, wired to the SDK.
//
// Kept apart from index.js so the tests can run it against the fake Gladys of
// the SDK (`createFakeGladys`) with a fake AccuWeather (`fetch`) and a
// temporary /data: index.js only builds the real ones and connects.
//
// Who calls what:
//   - Gladys pulls the weather (onWeatherGet) about every 30 minutes and on
//     every dashboard opening: served from the cache, refreshed when due;
//   - a one-minute timer refreshes the watched house when due, so the scene
//     triggers fire even when nobody looks at a dashboard;
//   - every refresh of the house runs the scene triggers, nudges the widgets
//     and, when the alerts changed, asks the core to re-pull the weather (its
//     own weather-alert scene triggers then fire within seconds, not 30 min).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AccuWeatherClient, AccuWeatherError, ERROR_KINDS } from './accuweather/client.js';
import { WeatherService } from './accuweather/service.js';
import { StateStore } from './accuweather/store.js';
import { buildActions, explainError } from './capabilities/actions.js';
import { buildSceneActions } from './capabilities/scenes.js';
import { TriggerWatcher } from './capabilities/triggers.js';
import { buildWidgets, refreshWidgets } from './capabilities/widgets.js';
import { isConfigured, maskKey, normalizeConfig } from './config.js';

const logger = createLogger({ name: 'app' });

/** The timer that refreshes the house when due. Requests only go out when due. */
export const TICK_MS = 60 * 1000;

/** The houses are read again this often (Gladys sends no event when one moves). */
export const HOUSES_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const NOT_CONFIGURED = {
  en: 'Paste your AccuWeather API key and save.',
  fr: "Collez votre clé d'API AccuWeather et enregistrez.",
  de: 'Füge deinen AccuWeather-API-Schlüssel ein und speichere.',
  es: 'Pegue su clave de API de AccuWeather y guarde.',
};

/**
 * Register every handler on `gladys` (before connect()).
 * @param {object} gladys a GladysIntegration (or the fake one of the SDK)
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch] AccuWeather transport (tests)
 * @param {string} [options.dataDir] where the state file lives (tests)
 * @param {() => number} [options.now] clock (tests)
 * @param {boolean} [options.timers] start the one-minute timer (false in tests)
 */
export function createApp(gladys, { fetch, dataDir, now = () => Date.now(), timers = true } = {}) {
  const store = new StateStore(dataDir ? { dir: dataDir } : {});
  const client = new AccuWeatherClient({ fetch, now });
  const service = new WeatherService({ client, store, config: normalizeConfig(), now });
  const watcher = new TriggerWatcher({ store, now });
  const actions = buildActions({ service, client });
  const sceneActions = buildSceneActions(service);
  const widgets = buildWidgets(service);

  let timer = null;
  let housesReadAt = 0;
  let lastStatus = null;
  let loaded = null;

  /** Restore /data once, before anything reads or counts. */
  function load() {
    loaded ??= store.load().then((state) => {
      client.calls = [...(state.calls ?? [])];
    });
    return loaded;
  }

  // --- Every refresh of the house -------------------------------------------
  service.onHomeRefreshed(async (weather) => {
    const { alertsChanged } = await watcher.evaluate(gladys, weather);
    if (alertsChanged) {
      gladys.requestWeatherRefresh();
    }
    refreshWidgets(gladys);
    await reportStatus();
  });

  // --- Gladys asks for the weather (the core widget, the chat, the alerts) ----
  gladys.onWeatherGet(async (options) => {
    await load();
    if (!isConfigured(service.config)) {
      // Throwing makes the core fall through to the next weather provider.
      throw new AccuWeatherError('AccuWeather API key not configured', { kind: ERROR_KINDS.AUTH });
    }
    logger.debug(`onWeatherGet <- ${options.latitude},${options.longitude} (${options.units})`);
    try {
      return await service.pivotAt(options);
    } finally {
      await reportStatus();
    }
  });

  // --- Configuration screen buttons ------------------------------------------
  for (const [key, handler] of Object.entries(actions)) {
    gladys.onAction(key, async (fields) => {
      await load();
      logger.info(`Action ${key}`);
      const message = await handler(fields);
      await reportStatus();
      return message;
    });
  }

  // --- Scene actions ---------------------------------------------------------
  for (const [key, handler] of Object.entries(sceneActions)) {
    gladys.onSceneAction(key, async (fields) => {
      await load();
      return handler(fields);
    });
  }

  // --- Dashboard widgets -----------------------------------------------------
  for (const [key, widget] of Object.entries(widgets)) {
    gladys.onWidgetGet(key, async (request) => {
      await load();
      return widget.get(request);
    });
    gladys.onWidgetAction(key, async (actionKey) => {
      await load();
      try {
        return await widget.action(actionKey);
      } catch (err) {
        // The toast holds 200 characters: the short explanation, not the stack.
        if (err instanceof AccuWeatherError) {
          return explainError(err);
        }
        throw err;
      }
    });
  }

  // --- Configuration saved ---------------------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    await load();
    const config = normalizeConfig(raw);
    const changes = service.setConfig(config);
    logger.info(
      `Configuration updated (key ${maskKey(config.api_key) || 'none'}, every ${config.refresh_minutes} min)`,
    );
    await tick({ force: changes.keyChanged || changes.locationChanged || changes.languageChanged });
    // The core's weather follows the new key or language at once.
    gladys.requestWeatherRefresh();
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      await load();
      service.setConfig(normalizeConfig(await gladys.getConfig()));
      housesReadAt = 0;
      lastStatus = null;
      await tick();
      refreshWidgets(gladys);
      startTimer();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Logs der Integration.',
          es: 'La inicialización ha fallado, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  gladys.on('disconnected', () => {
    stopTimer();
  });

  /** Refresh the house when due (never throws: the timer must keep going). */
  async function tick({ force = false } = {}) {
    try {
      await readHouses();
      if (isConfigured(service.config) && service.home) {
        await service.homeWeather({ force });
      }
    } catch (err) {
      logger.warn(`Refresh of the house failed: ${err.message}`);
    }
    await reportStatus();
  }

  /** The house the widgets and triggers watch: the first located one. */
  async function readHouses() {
    if (now() - housesReadAt < HOUSES_MAX_AGE_MS && service.home) {
      return;
    }
    try {
      const houses = await gladys.getHouses();
      housesReadAt = now();
      const house = houses.find(
        (candidate) => Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude),
      );
      const home = house
        ? { latitude: house.latitude, longitude: house.longitude, name: house.name }
        : null;
      if (home?.name !== service.home?.name || !home) {
        logger.info(home ? `Watching the house "${home.name}"` : 'No located house in Gladys');
      }
      service.setHome(home);
    } catch (err) {
      // 403 on a core that refuses `location`: the widgets say so, onWeatherGet still works.
      logger.warn(`Could not read the houses: ${err.message}`);
    }
  }

  /** The status of the Configuration screen, sent only when it changes. */
  async function reportStatus() {
    let status;
    if (!isConfigured(service.config)) {
      status = [false, NOT_CONFIGURED];
    } else if (service.lastError) {
      status = [false, explainError(service.lastError)];
    } else {
      status = [true];
    }
    const key = JSON.stringify(status);
    if (key === lastStatus) {
      return;
    }
    try {
      await gladys.setConnectionStatus(...status);
      lastStatus = key;
    } catch (err) {
      logger.debug(`Could not report the connection status: ${err.message}`);
    }
  }

  function startTimer() {
    stopTimer();
    if (timers) {
      timer = setInterval(() => {
        tick();
      }, TICK_MS);
      timer.unref?.();
    }
  }

  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function shutdown() {
    stopTimer();
    // The requests made since the last refresh (a location lookup) count too.
    store.state.calls = client.calls;
    await store.save();
  }

  return { service, store, client, watcher, tick, shutdown, load };
}
