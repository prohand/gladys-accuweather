// -----------------------------------------------------------------------------
// What survives a restart, in /data (the only writable path of the container).
//
// Every AccuWeather request counts against a daily quota: a Gladys restart, an
// update of the integration or a reconnection must not pay again for a location
// key or a forecast fetched ten minutes earlier. Nor must it fire again a scene
// trigger already fired for the same alert.
//
// One small JSON file, written whole (temporary file + rename, so a crash never
// leaves half a file). A file that cannot be read starts from scratch; a write
// that fails is logged and the integration goes on from memory.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_DATA_DIR = process.env.DATA_DIR || '/data';
export const STATE_FILE = 'accuweather-state.json';

/** Bumped when the shape changes: an older file is then ignored. */
const STATE_VERSION = 1;

export function emptyState() {
  return {
    version: STATE_VERSION,
    /** "lat,lon" rounded -> AccuWeather location `{ key, name }` */
    locations: {},
    /** location key -> `{ current, hourly, daily, alerts, fetched: { part: time } }` */
    weather: {},
    /** Timestamps of the requests of the last 24 hours. */
    calls: [],
    /** Scene trigger memory (see src/capabilities/triggers.js). */
    triggers: {},
  };
}

export class StateStore {
  /** @param {{ dir?: string }} [options] */
  constructor({ dir = DEFAULT_DATA_DIR } = {}) {
    this.dir = dir;
    this.path = join(dir, STATE_FILE);
    this.state = emptyState();
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (parsed?.version === STATE_VERSION) {
        this.state = { ...emptyState(), ...parsed };
      } else {
        logger.info(`Ignoring ${this.path}: written by another version`);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn(`Could not read ${this.path}, starting from scratch: ${err.message}`);
      }
    }
    return this.state;
  }

  /** Write the state; calls are serialized so two saves never interleave. */
  save() {
    this.writing = this.writing.then(() => this.write()).catch(() => {});
    return this.writing;
  }

  async write() {
    const temporary = `${this.path}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temporary, JSON.stringify(this.state));
      await rename(temporary, this.path);
    } catch (err) {
      logger.warn(`Could not save ${this.path}: ${err.message}`);
    }
  }
}
