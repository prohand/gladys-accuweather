# AccuWeather

Cette intégration fait d'[AccuWeather](https://www.accuweather.com) le
fournisseur météo de Gladys : le widget météo de Gladys, l'assistant de chat
et les alertes météo l'utilisent à la place du service OpenWeather intégré.
Elle ajoute aussi des déclencheurs et des actions de scène AccuWeather, et
deux widgets de tableau de bord (Gladys 5.3.0 ou plus récent est requis).

C'est une intégration **cloud** : elle a besoin d'un accès Internet et d'une
clé d'API AccuWeather. Rien ne tourne sur votre réseau local.

## Avant de commencer

1. Créez un compte gratuit sur
   [developer.accuweather.com](https://developer.accuweather.com).
2. Dans **My Apps**, ajoutez une application (nom libre) et copiez sa
   **clé d'API** (API key).
3. Dans Gladys, vérifiez que votre maison a une position : **Paramètres >
   Maisons**, puis placez la maison sur la carte. À l'installation,
   l'intégration demande à lire la position de vos maisons : elle utilise la
   première maison qui en a une.

## Configuration

Ouvrez l'onglet **Configuration** de l'intégration :

| Champ                                    | Rôle                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clé d'API                                | La clé de votre application AccuWeather. Obligatoire.                                                                                                                                     |
| Langue des textes AccuWeather            | Langue des noms d'alertes et des descriptions du temps (« Éclaircies »…). Anglais, français, allemand ou espagnol.                                                                        |
| Intervalle de rafraîchissement (minutes) | Fréquence des requêtes à AccuWeather, de 30 à 1440 minutes. 120 par défaut.                                                                                                               |
| Prévisions horaires (12 heures)          | Les 12 prochaines heures. Nécessaire au déclencheur « Pluie attendue » et à la courbe du widget.                                                                                          |
| Alertes météo                            | Alertes officielles relayées par AccuWeather. Pas incluses dans toutes les offres : si votre offre les refuse, l'intégration arrête de les demander.                                      |
| Clé de lieu AccuWeather                  | Facultatif. Laissez vide pour utiliser la position de votre maison. Renseignez-la (par exemple `623` pour Paris) pour imposer un autre lieu AccuWeather.                                  |
| Maison à surveiller                      | Facultatif. La maison dont les widgets et les déclencheurs de scène suivent la météo ; vide = la première maison placée sur la carte. Une maison choisie sans position ne surveille rien. |

Enregistrez, puis cliquez sur **Tester la connexion** : le lieu AccuWeather
trouvé, la météo actuelle et le nombre de requêtes par jour de vos réglages
s'affichent.

### Votre quota quotidien

AccuWeather compte chaque requête. Les clés gratuites les plus anciennes
permettent **50 requêtes par jour** ; l'essai et les offres payantes en
permettent plus. Un rafraîchissement coûte :

- 1 requête pour les conditions actuelles ;
- 1 pour les prévisions sur 12 heures (si activées) ;
- 1 pour les alertes (si activées) ;
- 1 pour les prévisions sur 5 jours, au plus toutes les 3 heures.

À 120 minutes (le réglage par défaut), cela fait environ **44 requêtes par
jour**. Chaque réponse est gardée en cache, même après un redémarrage :
ouvrir un tableau de bord, les contrôles météo de Gladys (toutes les 30
minutes) et les scènes ne coûtent pas de requête en plus. Seuls les boutons
**Actualiser** et l'action de scène `refresh_weather` interrogent AccuWeather
tout de suite (au plus une fois toutes les 5 minutes).

Quand le quota est épuisé, l'intégration continue d'afficher la dernière
météo reçue (jusqu'à 24 heures) et attend une heure avant de redemander.

## Actions de l'écran Configuration

- **Tester la connexion** — vérifie la clé et le lieu, et affiche le nombre de
  requêtes des dernières 24 heures.
- **Actualiser la météo maintenant** — interroge AccuWeather tout de suite.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes, dans la
catégorie **Intégrations**.

### Déclencheurs

Chaque déclencheur se lance **une fois par changement**, jamais à chaque
rafraîchissement. Le premier rafraîchissement après l'installation enregistre
seulement la situation actuelle.

- **AccuWeather : nouvelle alerte météo** (`weather_alert`) — une alerte
  officielle a été émise pour votre maison. Filtrez sur la gravité (mineure,
  modérée, sévère, extrême) et sur le phénomène (vent, pluie, orages, neige
  et verglas…). Variables : `{{triggerEvent.data.event}}` (nom de l'alerte),
  `severity`, `type`, `description`, `starts_at`, `ends_at`, `location`.
- **AccuWeather : le ciel a changé** (`condition_changed`) — les conditions
  actuelles ont changé, par exemple de dégagé à pluie. Filtrez sur la
  nouvelle condition. Le brouillard à 0 °C ou moins est signalé comme
  brouillard givrant, et un orage qui tombe en neige comme orage de neige ;
  la nuit, la condition reste la vraie (dégagé, pluie…), jamais une « nuit »
  générique. Variables : `condition`, `previous_condition`,
  `description`, `temperature` (°C), `location`.
- **AccuWeather : pluie attendue** (`rain_expected`) — des précipitations sont
  prévues dans les 3 prochaines heures, alors qu'il n'y en avait pas au
  rafraîchissement précédent. Demande les prévisions horaires. Filtrez sur
  pluie, neige, glace ou mixte. Variables : `precipitation_type`,
  `starts_at`, `hours_until`, `probability`, `location`.
- **AccuWeather : gel attendu** (`frost_expected`) — un jour prévu descend à
  0 °C ou moins. Une fois par jour. Variables : `date`, `temperature_min`
  (°C), `location`.

Gladys a aussi son propre déclencheur « alerte météo » : il fonctionne avec
cette intégration, et réagit en quelques secondes quand AccuWeather publie ou
termine une alerte.

### Actions

- **AccuWeather : lire les prévisions** (`get_forecast`) — aujourd'hui,
  demain ou après-demain. Donne `condition`, `description`,
  `temperature_min`, `temperature_max`, `precipitation_probability`,
  `rain_expected`, `wind_speed` et `uv_index` aux actions suivantes.
  Exemple : « si `rain_expected` est vrai, envoie-moi un message ».
- **AccuWeather : lire la météo actuelle** (`get_current_conditions`) — donne
  `condition`, `description`, `temperature`, `apparent_temperature`,
  `humidity`, `wind_speed`, `uv_index` et `is_day`.
- **AccuWeather : actualiser maintenant** (`refresh_weather`) — interroge
  AccuWeather tout de suite. Donne `refreshed` et `calls_last_24h`.

Les deux actions de lecture utilisent le cache : elles ne coûtent aucune
requête. Choisissez les unités métriques (°C, m/s) ou US (°F, mph) dans
chaque action.

## Tableau de bord

Ajoutez les widgets depuis l'éditeur de tableau de bord :

- **AccuWeather en direct** — température, ressenti, humidité, vent, une
  courbe des 12 prochaines heures, les alertes, la pluie à venir et le nombre
  de requêtes utilisées sur 24 heures. Un bouton **Actualiser** interroge
  AccuWeather tout de suite.
- **AccuWeather 5 jours** — les prochains jours avec les mots d'AccuWeather,
  de jour et de nuit. Son réglage **Jours affichés** va de 1 à 5.

## Dépannage

- **« AccuWeather refuse la clé d'API »** — recopiez la clé depuis
  developer.accuweather.com (My Apps), sans espace, et enregistrez.
- **« Le quota quotidien AccuWeather est épuisé »** — augmentez l'intervalle
  de rafraîchissement, ou désactivez les prévisions horaires ou les alertes.
  Le quota revient sous 24 heures.
- **« Renseignez la position de votre maison »** — votre maison Gladys n'a pas
  de position : renseignez-la dans Paramètres > Maisons.
- **Mauvaise ville** — renseignez la clé de lieu AccuWeather : cherchez votre
  ville sur accuweather.com, la clé est le nombre à la fin de son adresse.
- Les logs de l'intégration sont dans l'interface Gladys (page de
  l'intégration) ou avec `docker logs` sur l'hôte.
