import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-accuweather';

test('the first release moves Unreleased under its version', () => {
  const text = `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Weather.\n\n[Unreleased]: ${REPO}/commits/main\n`;
  const rolled = rollChangelog(text, '1.0.0', '2026-10-16');
  assert.match(
    rolled,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-16\n\n### Added\n\n- Weather\./,
  );
  assert.match(rolled, /\[Unreleased\]: .*\/compare\/v1\.0\.0\.\.\.HEAD/);
  assert.match(rolled, /\[1\.0\.0\]: .*\/releases\/tag\/v1\.0\.0/);
});

test('a later release compares with the previous tag', () => {
  const text = `## [Unreleased]\n\n- Fix.\n\n## [1.0.0] - 2026-10-16\n\n- Weather.\n\n[Unreleased]: ${REPO}/compare/v1.0.0...HEAD\n[1.0.0]: ${REPO}/releases/tag/v1.0.0\n`;
  const rolled = rollChangelog(text, '1.0.1', '2026-10-20');
  assert.match(rolled, /\[1\.0\.1\]: .*\/compare\/v1\.0\.0\.\.\.v1\.0\.1/);
  assert.equal(rollChangelog(rolled, '1.0.1', '2026-10-20'), rolled);
});

test('an empty Unreleased section still names the release', () => {
  const rolled = rollChangelog('## [Unreleased]\n', '1.0.2', '2026-10-21');
  assert.match(rolled, /## \[1\.0\.2\] - 2026-10-21\n\n- Maintenance release/);
});
