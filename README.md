# AccuWeather — Gladys Assistant integration

External integration making [AccuWeather](https://www.accuweather.com) the
weather provider of [Gladys Assistant](https://gladysassistant.com), with
AccuWeather scene triggers, scene actions and dashboard widgets (Gladys 5.1+).

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

| Surface                            | Manifest key                                                            | Code                                                             |
| ---------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Weather provider (`type: weather`) | `onWeatherGet`: current conditions, 12 hours, 5 days, alerts            | [`src/accuweather/`](./src/accuweather)                          |
| Scene triggers                     | `weather_alert`, `condition_changed`, `rain_expected`, `frost_expected` | [`src/capabilities/triggers.js`](./src/capabilities/triggers.js) |
| Scene actions                      | `get_forecast`, `get_current_conditions`, `refresh_weather`             | [`src/capabilities/scenes.js`](./src/capabilities/scenes.js)     |
| Dashboard widgets                  | `accuweather_now`, `accuweather_forecast`                               | [`src/capabilities/widgets.js`](./src/capabilities/widgets.js)   |
| Configuration screen buttons       | `test_connection`, `refresh_now`                                        | [`src/capabilities/actions.js`](./src/capabilities/actions.js)   |

- **Transport: cloud** (`"transports": ["cloud"]`): the integration only talks
  to `https://dataservice.accuweather.com`, authenticated with the user's API
  key in the `Authorization: Bearer` header.
- **Location**: the manifest declares `"location": true` — the scene triggers
  and the widgets need the position of the house outside `onWeatherGet`. The
  first located house of Gladys is watched; a location key typed in the
  configuration wins.
- **Languages**: every text (manifest, messages, widgets, docs) exists in
  English, French, German and Spanish.

## Built around the daily quota

AccuWeather counts every request (50 a day on the oldest free keys). One
refresh costs up to 4 requests (current conditions, 12-hour forecast, alerts,
and the 5-day forecast at most every 3 hours): at the default 120-minute
interval, about 44 a day.

- Every answer is cached per AccuWeather location, in memory **and** in
  `/data/accuweather-state.json`: Gladys pulling the weather every 30 minutes,
  dashboards, scenes and restarts reuse it.
- Forecasts are always asked in metric and converted locally: a user in °F
  and one in °C cost the same requests.
- Concurrent readers share one refresh; a forced refresh is not repeated
  within 5 minutes.
- "Quota exceeded" (503/429) or a refused key (401) stop the requests for an
  hour and keep serving the last answer (up to 24 hours old). An endpoint the
  plan does not include (403, e.g. alerts) is no longer asked.
- The number of requests of the last 24 hours (and `RateLimit-Remaining` when
  AccuWeather sends it) is shown in the widget and by "Test the connection".

## Project structure

```
.
├─ index.js                        # builds the SDK client, starts the app, connects
├─ src/
│  ├─ app.js                       # every handler, the one-minute timer, the status
│  ├─ config.js                    # DEFAULT_CONFIG (mirrors the manifest) + normalization
│  ├─ i18n.js                      # en / fr / de / es helpers
│  ├─ accuweather/
│  │  ├─ client.js                 # HTTP client, error kinds, request counter
│  │  ├─ service.js                # cache per location, refresh rules, house watched
│  │  ├─ pivot.js                  # AccuWeather answers -> Gladys pivot weather format
│  │  ├─ conditions.js             # icons -> conditions, alerts -> CAP severities/types
│  │  └─ store.js                  # /data persistence
│  └─ capabilities/
│     ├─ triggers.js               # scene triggers (one event per change)
│     ├─ scenes.js                 # scene actions
│     ├─ widgets.js                # dashboard widgets
│     └─ actions.js                # Configuration screen buttons
├─ docs/{en,fr,de,es}.md           # user documentation, re-hosted by Gladys
├─ test/                           # node --test, fake Gladys (SDK) + fake AccuWeather
├─ gladys-assistant-integration.json
├─ Dockerfile                      # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md · CLAUDE.md · SECURITY.md
└─ .github/                        # CI, Release, Build, GitHub releases, Dependabot
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="accuweather" \
DATA_DIR=./data \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor inside
the container. `DATA_DIR` defaults to `/data`, the only writable path of the
container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test — no network, no Gladys needed
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI runs the first three on Node 22 and 24 on every push and pull request,
and on pull requests also the store checks and a Docker build.

## Publishing

1. Add the GitHub topic `gladys-assistant-integration` to the repository, and
   turn on **Private vulnerability reporting** (see [SECURITY.md](./SECURITY.md)).
2. Describe the changes under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md).
3. **Actions → Release → Run workflow** and pick `patch`, `minor` or `major`:
   the workflow bumps `package.json` and the manifest (`version` +
   `docker_image`), rolls the changelog, tags `vX.Y.Z`, builds the
   `linux/amd64` + `linux/arm64` image to `ghcr.io/prohand/gladys-accuweather`
   and publishes the GitHub Release.
4. Make the ghcr.io package **public** (first release only): the store checks
   that the image can be pulled anonymously.

The repository starts at version `0.0.0`: the first `major` release
publishes `1.0.0`.

## License

Apache-2.0. AccuWeather is a trademark of AccuWeather, Inc.; this project is
not affiliated with it.
