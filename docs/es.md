# AccuWeather

Esta integración convierte [AccuWeather](https://www.accuweather.com) en el
proveedor meteorológico de Gladys: el widget del tiempo de Gladys, el
asistente de chat y las alertas meteorológicas lo usan en lugar del servicio
OpenWeather integrado. También añade disparadores y acciones de escena de
AccuWeather, y dos widgets para el panel (se requiere Gladys 5.3.0 o posterior).

Es una integración **en la nube**: necesita acceso a Internet y una clave de
API de AccuWeather. No se ejecuta nada en su red local.

## Antes de empezar

1. Cree una cuenta gratuita en
   [developer.accuweather.com](https://developer.accuweather.com).
2. En **My Apps**, añada una aplicación (cualquier nombre) y copie su
   **clave de API** (API key).
3. En Gladys, compruebe que su casa tiene una ubicación: **Ajustes > Casas**,
   y sitúe la casa en el mapa. Al instalarla, la integración pide leer la
   ubicación de sus casas: usa la primera casa que tenga una.

## Configuración

Abra la pestaña **Configuración** de la integración:

| Campo                                | Para qué sirve                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clave de API                         | La clave de su aplicación de AccuWeather. Obligatoria.                                                                                                                   |
| Idioma de los textos de AccuWeather  | Idioma de los nombres de alertas y de las descripciones del tiempo («Parcialmente soleado»…). Inglés, francés, alemán o español.                                         |
| Intervalo de actualización (minutos) | Frecuencia de las peticiones a AccuWeather, de 30 a 1440 minutos. 120 por defecto.                                                                                       |
| Previsión por horas (12 horas)       | Las próximas 12 horas. Necesaria para el disparador «Lluvia prevista» y para la curva del widget.                                                                        |
| Alertas meteorológicas               | Alertas oficiales difundidas por AccuWeather. No están en todos los planes: si su plan las rechaza, la integración deja de pedirlas.                                     |
| Clave de ubicación AccuWeather       | Opcional. Déjela vacía para usar la ubicación de su casa. Rellénela (por ejemplo `623` para París) para imponer otra ubicación de AccuWeather.                           |
| Casa a vigilar                       | Opcional. La casa cuyo tiempo siguen los widgets y los disparadores de escenas; vacía = la primera casa situada en el mapa. Una casa elegida sin ubicación no se vigila. |

Guarde y pulse **Probar la conexión**: se muestran la ubicación de AccuWeather
encontrada, el tiempo actual y cuántas peticiones al día cuestan sus ajustes.

### Su cuota diaria

AccuWeather cuenta cada petición. Las claves gratuitas más antiguas permiten
**50 peticiones al día**; la prueba y los planes de pago permiten más. Una
actualización cuesta:

- 1 petición para las condiciones actuales;
- 1 para la previsión de 12 horas (si está activada);
- 1 para las alertas (si están activadas);
- 1 para la previsión de 5 días, como mucho cada 3 horas.

Con 120 minutos (el valor por defecto) son unas **44 peticiones al día**.
Cada respuesta se guarda en caché, también tras un reinicio: abrir un panel,
las consultas del tiempo de Gladys (cada 30 minutos) y las escenas no cuestan
peticiones extra. Solo los botones **Actualizar** y la acción de escena
`refresh_weather` consultan AccuWeather al momento (como mucho una vez cada 5
minutos).

Cuando la cuota se agota, la integración sigue mostrando el último tiempo
recibido (hasta 24 horas de antigüedad) y espera una hora antes de volver a
preguntar.

## Acciones de la pantalla de configuración

- **Probar la conexión** — comprueba la clave y la ubicación, y muestra el
  número de peticiones de las últimas 24 horas.
- **Actualizar el tiempo ahora** — consulta AccuWeather al momento.

## Escenas

La integración añade sus propias tarjetas al editor de escenas, en la
categoría **Integraciones**.

### Disparadores

Cada disparador se activa **una vez por cambio**, nunca en cada
actualización. La primera actualización tras la instalación solo registra la
situación actual.

- **AccuWeather: nueva alerta meteorológica** (`weather_alert`) — se ha emitido
  una alerta oficial para su casa. Filtre por gravedad (menor, moderada,
  grave, extrema) y por fenómeno (viento, lluvia, tormentas, nieve y
  hielo…). Variables: `{{triggerEvent.data.event}}` (nombre de la alerta),
  `severity`, `type`, `description`, `starts_at`, `ends_at`, `location`.
- **AccuWeather: el cielo ha cambiado** (`condition_changed`) — las
  condiciones actuales han cambiado, por ejemplo de despejado a lluvia.
  Filtre por la nueva condición. La niebla a 0 °C o menos se indica como
  niebla helada, y una tormenta que cae en forma de nieve como nieve con
  tormenta; de noche, la condición sigue siendo la real (despejado,
  lluvia…), nunca una «noche» genérica. Variables: `condition`,
  `previous_condition`, `description`, `temperature` (°C), `location`.
- **AccuWeather: lluvia prevista** (`rain_expected`) — se prevé precipitación
  en las próximas 3 horas, cuando en la actualización anterior no la había.
  Requiere la previsión por horas. Filtre por lluvia, nieve, hielo o mixta.
  Variables: `precipitation_type`, `starts_at`, `hours_until`,
  `probability`, `location`.
- **AccuWeather: helada prevista** (`frost_expected`) — un día previsto baja a
  0 °C o menos. Una vez por día. Variables: `date`, `temperature_min` (°C),
  `location`.

Gladys también tiene su propio disparador «alerta meteorológica»: funciona
con esta integración y reacciona en segundos cuando AccuWeather publica o
termina una alerta.

### Acciones

- **AccuWeather: leer la previsión** (`get_forecast`) — hoy, mañana o pasado
  mañana. Entrega `condition`, `description`, `temperature_min`,
  `temperature_max`, `precipitation_probability`, `rain_expected`,
  `wind_speed` y `uv_index` a las acciones siguientes. Ejemplo: «si
  `rain_expected` es verdadero, envíame un mensaje».
- **AccuWeather: leer el tiempo actual** (`get_current_conditions`) — entrega
  `condition`, `description`, `temperature`, `apparent_temperature`,
  `humidity`, `wind_speed`, `uv_index` e `is_day`.
- **AccuWeather: actualizar ahora** (`refresh_weather`) — consulta AccuWeather
  al momento. Entrega `refreshed` y `calls_last_24h`.

Las dos acciones de lectura usan la caché: no cuestan ninguna petición. Elija
unidades métricas (°C, m/s) o de EE. UU. (°F, mph) en cada acción.

## Panel

Añada los widgets desde el editor del panel:

- **AccuWeather ahora** — temperatura, sensación térmica, humedad, viento, una
  curva de las próximas 12 horas, las alertas, la lluvia prevista y el número
  de peticiones usadas en 24 horas. Un botón **Actualizar** consulta
  AccuWeather al momento.
- **AccuWeather 5 días** — los próximos días con las palabras de AccuWeather,
  de día y de noche. Su ajuste **Días mostrados** va de 1 a 5.

## Solución de problemas

- **«AccuWeather rechaza la clave de API»** — copie de nuevo la clave desde
  developer.accuweather.com (My Apps), sin espacios, y guarde.
- **«La cuota diaria de AccuWeather está agotada»** — aumente el intervalo de
  actualización o desactive la previsión por horas o las alertas. La cuota
  se renueva en 24 horas.
- **«Indique la ubicación de su casa»** — su casa en Gladys no tiene
  ubicación: indíquela en Ajustes > Casas.
- **Ciudad equivocada** — rellene la clave de ubicación de AccuWeather: busque
  su ciudad en accuweather.com, la clave es el número al final de su
  dirección.
- Los registros de la integración están en la interfaz de Gladys (página de
  la integración) o con `docker logs` en el host.
