// Run: npx tsx docs/v3-payload-sizing.mjs
// Actual schemas, worst-case four-byte Unicode and escaped ASCII backslashes.
// This measures serialization bounds; physical glyph widths require live BB checks.
import { generatedFaceV3Schema } from '../faces.ts';
import { rpcContract } from '../server.ts';
import { libraryViewSchema } from '../library.ts';
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const glyph = '\u{10013}';
const rendering = (length, ascii = false) => {
  const text = (ascii ? String.fromCharCode(92) : glyph).repeat(length);
  return { idle: text, running: text, waiting: text, error: text, runningFrames: Array(4).fill(text) };
};
const pair = [glyph.repeat(4), glyph.repeat(4)];
const snapshot = generatedFaceV3Schema.parse({
  version: 3, family: 'classic', templateId: 'x'.repeat(64), personality: 'cheerful',
  outline: pair, eyePair: pair, mouth: glyph.repeat(4), accessory: glyph.repeat(4),
  layers: { gesture: pair, facialMarks: pair, surroundings: pair },
  capabilities: { builtInAppendages: false, allowedLayers: ['gesture', 'facialMarks', 'surroundings'] },
  blinkOffset: 3999, base: rendering(40), renderings: {
    compact: rendering(6), expressive: rendering(40),
    ascii: { compact: rendering(6, true), expressive: rendering(40, true) },
  },
});
const identities = rpcContract.getMany.output.parse(Array(200).fill({
  threadId: 'thr_'.padEnd(128, 'x'), projectId: 'x'.repeat(128), face: snapshot.base.idle,
  source: 'generated', generated: snapshot, glyphProfile: 'unicode',
}));
const entries = Array(70).fill({ kind: 'generated', face: snapshot.base.idle, snapshotId: 'f'.repeat(64), glyphProfile: 'unicode' });
const referenceLibrary = { version: 2, ...libraryViewSchema.parse({ favorites: entries.slice(0,50), recent: entries.slice(50) }), legacyProjectionFingerprint: 'f'.repeat(64) };
const measured = {
  snapshotBytes: bytes(snapshot), identityBytes: bytes(identities[0]),
  getMany200Bytes: bytes(identities), getMany64Bytes: bytes(identities.slice(0,64)),
  inlineLibrary70Bytes: bytes({ ...referenceLibrary, favorites: entries.slice(0,50).map(entry => ({...entry, identity:snapshot})), recent: entries.slice(50).map(entry => ({...entry, identity:snapshot})) }),
  referenceLibrary70Bytes: bytes(referenceLibrary),
  separateSnapshotKeyBytes: bytes({version:1,identity:snapshot,glyphProfile:'unicode'}),
};
if (measured.getMany200Bytes > 1024*1024) throw new Error('getMany exceeds 1 MiB');
if (measured.referenceLibrary70Bytes > 192*1024) throw new Error('Index exceeds 192 KiB');
if (measured.separateSnapshotKeyBytes > 16*1024) throw new Error('Snapshot exceeds 16 KiB');
console.log(JSON.stringify(measured,null,2));
