// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers: these tests keep both sides in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTIONS } from '../src/capabilities/actions.js';
import { FORECAST_DAYS, SCENE_ACTIONS } from '../src/capabilities/scenes.js';
import { OTHER_ALERT_TYPE, SCENE_TRIGGERS } from '../src/capabilities/triggers.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { PRECIPITATION_TYPES, SKY_CONDITIONS } from '../src/accuweather/conditions.js';
import { LANGUAGES } from '../src/i18n.js';
import { WEATHER_ALERT_SEVERITIES, WEATHER_ALERT_TYPES } from '@gladysassistant/integration-sdk';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const keysOf = (list) => (list ?? []).map((entry) => entry.key).sort();
const optionsOf = (list, key, field) =>
  list
    .find((entry) => entry.key === key)
    .fields.find((entry) => entry.key === field)
    .options.map((option) => option.value)
    .sort();

const allFields = [
  ...manifest.config_schema,
  ...[...manifest.actions, ...manifest.scene_triggers, ...manifest.scene_actions].flatMap(
    (item) => item.fields ?? [],
  ),
  ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
];

test('a weather provider for the cloud, with the house location', () => {
  assert.equal(manifest.type, 'weather');
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.equal(manifest.location, true);
});

test('the declared keys are the ones the code handles', () => {
  assert.deepEqual(keysOf(manifest.actions), Object.values(ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.scene_actions), Object.values(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(SCENE_TRIGGERS).sort());
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET_KEYS).sort());
});

test('the trigger filters offer exactly the values the code fires', () => {
  const triggers = manifest.scene_triggers;
  assert.deepEqual(
    optionsOf(triggers, 'weather_alert', 'severity'),
    Object.values(WEATHER_ALERT_SEVERITIES).sort(),
  );
  assert.deepEqual(
    optionsOf(triggers, 'weather_alert', 'type'),
    [...Object.values(WEATHER_ALERT_TYPES), OTHER_ALERT_TYPE].sort(),
  );
  assert.deepEqual(
    optionsOf(triggers, 'condition_changed', 'condition'),
    [...SKY_CONDITIONS].sort(),
  );
  assert.deepEqual(
    optionsOf(triggers, 'rain_expected', 'precipitation_type'),
    Object.values(PRECIPITATION_TYPES).sort(),
  );
  assert.deepEqual(
    optionsOf(manifest.scene_actions, 'get_forecast', 'day'),
    Object.keys(FORECAST_DAYS).sort(),
  );
});

test('every filter of a trigger is also a variable, so the event carries it', () => {
  for (const trigger of manifest.scene_triggers) {
    const variables = keysOf(trigger.variables);
    for (const field of trigger.fields ?? []) {
      assert.ok(variables.includes(field.key), `${trigger.key}.${field.key}`);
    }
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.default, undefined);
      assert.equal(field.required, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//);
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" missing in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('the watched house is picked from the Gladys houses, empty by default', () => {
  const field = manifest.config_schema.find((entry) => entry.key === 'house');
  assert.equal(field.type, 'select');
  assert.equal(field.source, 'houses');
  // The store refuses a default (and static options) on a dynamic source.
  assert.equal(field.default, undefined);
  assert.equal(field.options, undefined);
  assert.equal(DEFAULT_CONFIG.house, '');
});

test('the API key is a secret field', () => {
  const field = manifest.config_schema.find((entry) => entry.key === 'api_key');
  assert.equal(field.type, 'secret');
  assert.equal(field.required, true);
});

test('every field uses a type the store accepts, keys in snake_case', () => {
  const types = ['string', 'number', 'boolean', 'select', 'multi_select', 'secret', 'section'];
  for (const field of allFields) {
    assert.ok(types.includes(field.type), `field "${field.key}": type ${field.type}`);
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder object`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number');
    }
  }
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every text of the manifest exists in en, fr, de and es', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 100, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the store length limits hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key}`);
  }
});

/** The minimum of the `gladys_version` range, as numbers. */
function gladysFloor() {
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(manifest.gladys_version);
  assert.ok(match, `gladys_version "${manifest.gladys_version}" is not a plain >= range`);
  return match.slice(1).map(Number);
}

const floorAtLeast = ([major, minor]) => {
  const [floorMajor, floorMinor] = gladysFloor();
  return floorMajor > major || (floorMajor === major && floorMinor >= minor);
};

test('the Gladys floor covers every field the manifest declares', () => {
  // Older cores validate the manifest against a strict allowlist and refuse it
  // whole over a field they do not know.
  if (manifest.categories) {
    assert.ok(floorAtLeast([4, 86]), 'categories need Gladys 4.86.0');
  }
  if (manifest.widgets || manifest.scene_triggers || manifest.scene_actions) {
    assert.ok(floorAtLeast([5, 1]), 'widgets and scene cards need Gladys 5.1.0');
  }
  if (allFields.some((field) => field.source === 'houses')) {
    assert.ok(floorAtLeast([5, 2]), 'a houses select needs Gladys 5.2.0');
  }
  if (manifest.keywords || manifest.countries || manifest.music) {
    assert.ok(floorAtLeast([5, 3]), 'keywords, countries and music need Gladys 5.3.0');
  }
  // What this integration declares today.
  assert.ok(floorAtLeast([5, 3]), manifest.gladys_version);
});

test('the categories stay inside the store vocabulary', () => {
  const vocabulary = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
    'transport',
    'vehicles',
    'servers',
    'leisure',
  ];
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(vocabulary.includes(category), category);
  }
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords), 'keywords are declared');
  assert.ok(keywords.length >= 1 && keywords.length <= 10, `${keywords.length} keywords`);
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    const length = keyword.trim().length;
    assert.ok(length >= 2 && length <= 30, `keyword "${keyword}": ${length} characters`);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords are unique');
});

test('AccuWeather covers the whole world: no country restriction', () => {
  // Declared countries hide the integration from the catalog everywhere else.
  assert.equal(manifest.countries, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  // The Release workflow writes all three.
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-accuweather:${manifest.version}`);
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    // The store refuses (en, fr) or skips (de, es) a page under 300 characters.
    assert.ok(text.trim().length >= 300, `docs/${language}.md is too short`);
    for (const key of [...Object.values(SCENE_TRIGGERS), ...Object.values(SCENE_ACTIONS)]) {
      assert.ok(text.includes(key), `docs/${language}.md does not name ${key}`);
    }
  }
});
