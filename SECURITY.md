# Security policy

## Supported versions

Only the latest release of the AccuWeather integration receives security fixes.
Update the integration from Gladys before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue, pull request or forum post for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-accuweather](https://github.com/prohand/gladys-accuweather/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove your AccuWeather API key, tokens and addresses first).

You should get a first answer within 7 days. A fix is released as a new version of the
integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes
(`ghcr.io/prohand/gladys-accuweather`).

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and AccuWeather's
services and API.

## What the integration handles

- **Your AccuWeather API key**: stored by Gladys in a secret field, sent only to
  `https://dataservice.accuweather.com` in the `Authorization` header, never written to the logs
  in full nor to `/data`.
- **The position of your house** (`location: true`): read from Gladys to ask AccuWeather for the
  weather of that place. Only the AccuWeather location key and its name are kept in `/data`.

## Good practices for users

- Keep the API key only in the integration's API key field; create a new one on
  developer.accuweather.com if it leaked.
- Keep Gladys and the integration up to date.
