import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('catalog progress shows the checkpoint stage and completed counts through large imports', () => {
  const rows = JSON.parse(execFileSync('php', [fileURLToPath(new URL('./catalog-progress-fixture.php', import.meta.url))], { encoding: 'utf8' }));
  assert.equal(rows[0].label, 'Importing product attributes');
  assert.match(rows[0].detail, /0 of 47/);
  assert.match(rows[1].detail, /123 of 789/);
  assert.equal(rows[2].label, 'Importing images and files');
  assert.match(rows[2].detail, /42 of 719/);
  assert.match(rows[3].detail, /171 of 171/);
  assert.equal(rows[3].percent, 94);
  assert.ok(rows.every((row, index) => row.percent >= 90 && (!index || row.percent >= rows[index - 1].percent)));
});
