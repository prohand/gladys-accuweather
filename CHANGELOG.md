# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under the Unreleased heading below as you make it. The Release workflow moves that
section under the version it ships, and the section becomes the notes of the GitHub Release.

## [Unreleased]

## [0.0.1] - 2026-10-16

### Added

- AccuWeather as the weather provider of Gladys: current conditions, 12-hour and 5-day forecasts
  and official alerts, in metric or US units.
- Scene triggers: new weather alert, the sky changed, rain expected within 3 hours, frost
  expected.
- Scene actions: read the forecast (today, tomorrow, the day after), read the current weather,
  refresh now.
- Dashboard widgets: "AccuWeather now" (conditions, next 12 hours, alerts, rain to come,
  requests used) and "AccuWeather 5 days".
- Configuration screen buttons: "Test the connection" and "Refresh the weather now".
- A cache kept across restarts and a request counter, so the default settings stay under 50
  AccuWeather requests a day.
- English, French, German and Spanish for the configuration screen, messages, widgets and
  documentation.
- `SECURITY.md`, `CLAUDE.md`, CI (Node 22 and 24, store checks, Docker build), Release, Build and
  GitHub releases workflows, Dependabot.

[Unreleased]: https://github.com/prohand/gladys-accuweather/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/prohand/gladys-accuweather/releases/tag/v0.0.1
