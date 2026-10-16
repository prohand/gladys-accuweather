# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) making **AccuWeather** the weather provider of
Gladys (manifest `type: "weather"`, `transports: ["cloud"]`, `location: true`). Gladys 5.1+ adds
scene triggers (new alert, sky changed, rain expected, frost expected), scene actions (read the
forecast, read the current weather, refresh) and two dashboard widgets.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/service.test.js            # one file
node --test --test-name-pattern "quota"     # one test by name
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24, plus the store checks and a Docker
build on pull requests. Releases: **Actions → Release** only (bumps `package.json`, manifest
`version` + `docker_image`, rolls `CHANGELOG.md`, re-runs Prettier, tags, builds, publishes the
GitHub Release).

## Architecture

```
index.js                     SDK client + app + connect (no logic)
src/app.js                   every handler, the one-minute timer, the connection status
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES (en, fr, de, es), pick, localize
src/accuweather/client.js    HTTP client: Bearer auth, error kinds, request counter
src/accuweather/service.js   cache per location key, refresh rules, the watched house
src/accuweather/pivot.js     raw answers -> pivot weather format (metric / us)
src/accuweather/conditions.js icon -> condition, alert -> CAP severity / type
src/accuweather/store.js     /data/accuweather-state.json
src/capabilities/            triggers, scene actions, widgets, Configuration screen actions
```

### Invariants worth knowing

- **The daily quota is the constraint.** One refresh = up to 4 requests. Everything reads
  through `WeatherService.weatherAt`, which only asks the parts older than `refresh_minutes`
  (daily forecast: at least 3 h). Never add a code path that calls the client directly for
  data a reader asked for.
- **Forecasts are fetched in metric only** and converted in `pivot.js`; current conditions carry
  both systems. Pivot metric wind is m/s (AccuWeather sends km/h).
- **The cache survives restarts** (`/data`, the only writable path). Location keys are cached for
  good, answers up to 24 h (served stale when AccuWeather fails), the request log for 24 h.
- **Refusals**: 401 → key refused, 503/429 → quota, both block requests for an hour (a new key
  lifts it). 403 on a part other than current conditions → that part is no longer asked.
- **Scene triggers fire once per change** and remember what they said in `/data`; the first
  reading after install only arms them. Publishing never throws.
- **Every refresh of the watched house** (timer, Gladys, widget, scene) runs the triggers, nudges
  the widgets, and calls `requestWeatherRefresh()` when the alerts changed.
- The API key is a secret: never log it (use `maskKey`), never put it in a URL.
- Trigger, action, widget and config keys are stored by users: never rename them.

### Manifest

`test/manifest.test.js` keeps `gladys-assistant-integration.json` in sync with the code: keys of
actions / scene actions / triggers / widgets, trigger filter options, `DEFAULT_CONFIG`, the four
languages of every text, store length limits, version coupling.

## Testing

No network: `test/helpers/fakeAccuWeather.js` fakes the AccuWeather endpoints (`fetch`), a clock
and a temporary `/data`; the SDK's `createFakeGladys()` plays Gladys (`test/app.test.js`).
Widgets are checked with `validateWidgetContent` (must return `[]`).

## Conventions

- **Versions belong to the Release workflow**: never edit `version` / `docker_image` by hand.
- **Changelog**: every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **User-facing text is `{ en, fr, de, es }`**: manifest, messages, widgets, and `docs/en.md`,
  `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync.
- Prettier formats, ESLint catches mistakes. Comments explain **why**, in English.
