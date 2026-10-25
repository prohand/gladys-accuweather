# AccuWeather

This integration makes [AccuWeather](https://www.accuweather.com) the weather
provider of Gladys: the Gladys weather widget, the chat assistant and the
weather alerts use it instead of the built-in OpenWeather service. It also
adds AccuWeather scene triggers, scene actions and two dashboard widgets
(Gladys 5.3.0 or later is required).

It is a **cloud** integration: it needs Internet access and an AccuWeather
API key. Nothing runs on your local network.

## Before you start

1. Create a free account on
   [developer.accuweather.com](https://developer.accuweather.com).
2. In **My Apps**, add an app (any name) and copy its **API key**.
3. In Gladys, check that your house has a position: **Settings > Houses**,
   then place the house on the map. The integration asks to read the
   position of your houses when you install it: it uses the first house that
   has one.

## Configuration

Open the **Configuration** tab of the integration:

| Field                         | What it does                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API key                       | The key of your AccuWeather app. Mandatory.                                                                                                                              |
| Language of AccuWeather texts | Language of the alert names and of the weather phrases ("Partly sunny"...). English, French, German or Spanish.                                                          |
| Refresh interval (minutes)    | How often AccuWeather is asked, from 30 to 1440 minutes. 120 by default.                                                                                                 |
| Hourly forecast (12 hours)    | The next 12 hours. Needed by the "Rain expected" trigger and by the curve of the widget.                                                                                 |
| Severe weather alerts         | Official alerts relayed by AccuWeather. Not included in every AccuWeather plan: when your plan refuses them, the integration stops asking.                               |
| AccuWeather location key      | Optional. Leave empty to use the position of your house. Fill it in (for example `623` for Paris) to force another AccuWeather location.                                 |
| House to watch                | Optional. The house whose weather the widgets and the scene triggers follow; empty = the first house placed on the map. A picked house with no position watches nothing. |

Save, then click **Test the connection**: it shows the AccuWeather location
found, the current weather, and how many requests your settings cost per day.

### Your daily quota

AccuWeather counts every request. The oldest free keys allow **50 requests a
day**; the trial and paid plans allow more. One refresh costs:

- 1 request for the current conditions;
- 1 for the 12-hour forecast (if turned on);
- 1 for the alerts (if turned on);
- 1 for the 5-day forecast, at most every 3 hours.

At 120 minutes (the default) that is about **44 requests a day**. Every
answer is kept in a cache, also across restarts: opening a dashboard, the
Gladys weather checks (every 30 minutes) and scenes do not cost extra
requests. Only **Refresh now** buttons and the `refresh_weather` scene action
ask AccuWeather at once (at most once every 5 minutes).

When the quota is spent, the integration keeps showing the last weather it
received (up to 24 hours old) and waits an hour before asking again.

## Configuration screen actions

- **Test the connection** — checks the key and the location, and shows the
  number of requests made over the last 24 hours.
- **Refresh the weather now** — asks AccuWeather now.

## Scenes

The integration adds its own cards to the scene editor, in the
**Integrations** category.

### Triggers

Each trigger fires **once per change**, never at every refresh. The first
refresh after the installation only records the current situation.

- **AccuWeather: new weather alert** (`weather_alert`) — an official alert was
  issued for your house. Filter on the severity (minor, moderate, severe,
  extreme) and on the phenomenon (wind, rain, thunderstorm, snow and ice...).
  Variables: `{{triggerEvent.data.event}}` (name of the alert), `severity`,
  `type`, `description`, `starts_at`, `ends_at`, `location`.
- **AccuWeather: the sky changed** (`condition_changed`) — the current
  conditions changed, for example from clear to rain. Filter on the new
  condition. Fog at or below 0 °C is reported as freezing fog, and a
  thunderstorm falling as snow as thundersnow; at night the condition stays
  the real one (clear, rain…), never a generic "night". Variables: `condition`, `previous_condition`, `description`,
  `temperature` (°C), `location`.
- **AccuWeather: rain expected** (`rain_expected`) — precipitation is
  forecast within the next 3 hours, where none was at the previous refresh.
  Needs the hourly forecast. Filter on rain, snow, ice or mixed. Variables:
  `precipitation_type`, `starts_at`, `hours_until`, `probability`, `location`.
- **AccuWeather: frost expected** (`frost_expected`) — a forecast day goes
  down to 0 °C or below. Fires once per day. Variables: `date`,
  `temperature_min` (°C), `location`.

Gladys also has its own "weather alert" trigger: it works with this
integration too, and reacts within seconds when AccuWeather publishes or
ends an alert.

### Actions

- **AccuWeather: read the forecast** (`get_forecast`) — today, tomorrow or the
  day after. Gives `condition`, `description`, `temperature_min`,
  `temperature_max`, `precipitation_probability`, `rain_expected`,
  `wind_speed` and `uv_index` to the next actions. Example: "if
  `rain_expected` is true, send me a message".
- **AccuWeather: read the current weather** (`get_current_conditions`) —
  gives `condition`, `description`, `temperature`, `apparent_temperature`,
  `humidity`, `wind_speed`, `uv_index` and `is_day`.
- **AccuWeather: refresh now** (`refresh_weather`) — asks AccuWeather now. Gives
  `refreshed` and `calls_last_24h`.

Both reading actions use the cache: they cost no request. Choose metric
(°C, m/s) or US (°F, mph) units in each action.

## Dashboard

Add the widgets from the dashboard editor:

- **AccuWeather now** — temperature, feels-like, humidity, wind, a curve of
  the next 12 hours, the alerts, the rain to come, and the number of
  requests used over 24 hours. A **Refresh** button asks AccuWeather now.
- **AccuWeather 5 days** — the next days with AccuWeather's own words, day
  and night. Its setting **Days shown** goes from 1 to 5.

## Troubleshooting

- **"AccuWeather refused the API key"** — copy the key again from
  developer.accuweather.com (My Apps), without spaces, and save.
- **"The daily AccuWeather quota is spent"** — raise the refresh interval or
  turn off the hourly forecast or the alerts. The quota comes back within
  24 hours.
- **"Set the position of your house"** — your Gladys house has no position:
  set it in Settings > Houses.
- **Wrong city** — fill in the AccuWeather location key: search your city on
  accuweather.com, the key is the number at the end of its address.
- The integration logs are in the Gladys interface (integration page) or with
  `docker logs` on the host.
