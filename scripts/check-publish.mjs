#!/usr/bin/env node
// Validate marketplace copy and real screenshots before publishing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const description = manifest.bb.description;
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const overview = readFileSync(join(root, 'PLUGIN_OVERVIEW.md'), 'utf8');
const errors = [];
const metadataOnly = process.argv.includes('--metadata-only');

if (!description || !readme.includes(description) || !overview.includes(description)) {
  errors.push('bb.description must appear verbatim in README.md and PLUGIN_OVERVIEW.md.');
}
if (!metadataOnly) for (const name of ['header-picker', 'sidebar-and-activity', 'settings-preview']) {
  const file = join(root, 'assets', 'screenshots', name + '.png');
  if (!existsSync(file)) {
    errors.push('Missing real BB screenshot: assets/screenshots/' + name + '.png');
    continue;
  }
  const image = readFileSync(file);
  if (image.length < 24 || image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    errors.push('Invalid PNG: ' + file);
    continue;
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width < 960 || height < 540) {
    errors.push('Screenshot must be at least 960x540: ' + file);
  }
}
if (errors.length) {
  for (const error of errors) console.error('Publish check: ' + error);
  process.exitCode = 1;
} else {
  console.log(metadataOnly
    ? 'Metadata check passed: descriptions agree (screenshots are a manual release gate).'
    : 'Publish check passed: descriptions agree and all three PNG captures exist.');
}
