import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedFaceV3Schema, renderFace, resolveFaceDisplay, UnsupportedFaceProfileError } from './faces';
import { FAMILY_DEFINITIONS, PERSONALITIES, composeCatalogFace, generateFaceV3, supportedInheritedEyes, validateFamilyDefinitions, varyFaceV3, assertLockedLayerCompatibility, CatalogVariationConflictError } from './family-definitions';

test('curated catalog has finite weights, valid pools and probabilities', () => {
  assert.deepEqual(validateFamilyDefinitions(), []);
  const bad = structuredClone(FAMILY_DEFINITIONS);
  bad[0]!.layers.gesture.probability = NaN;
  assert.ok(validateFamilyDefinitions(bad).some(value => value.includes('probability')));
});
test('every family has 192 distinct inherited-eye identities by direct enumeration', () => {
  for (const definition of FAMILY_DEFINITIONS) {
    const rendered = new Set<string>();
    const eyePair = definition.eyes[0]!.value;
    for (const template of definition.templates) for (const mouth of definition.mouths) for (const accessory of definition.accessories.candidates) {
      rendered.add(composeCatalogFace({ outline: template.outline, eyePair, mouth: mouth.value, accessory: accessory.value, layers: { ...(template.builtInGesture ? { gesture: template.builtInGesture } : {}), ...(template.builtInFacialMarks ? { facialMarks: template.builtInFacialMarks } : {}) } }));
    }
    assert.equal(rendered.size, 192, definition.family);
  }
});
test('ordered nesting, atomic inheritance and deliberate asymmetric pairs', () => {
  assert.equal(composeCatalogFace({ outline: ['(', ')'], eyePair: ['o', '^'], mouth: '_', accessory: '*', layers: { surroundings: ['<', '>'], gesture: ['L', 'R'], facialMarks: ['a', 'b'] } }), '<L(ao_^b)R*>');
  const definition = FAMILY_DEFINITIONS[0]!;
  assert.deepEqual(supportedInheritedEyes(definition, ['•', '˘']), ['•', '˘']);
  assert.equal(supportedInheritedEyes(definition, ['•', 'x']), undefined);
});
test('all fixed-seed families/personalities produce bounded valid immutable snapshots', () => {
  for (const definition of FAMILY_DEFINITIONS) for (const personality of PERSONALITIES) {
    const inheritedEyes = definition.eyes[0]!.value;
    const result = generateFaceV3('catalog-fixture', definition.family, { seed: 7, personality, inheritedEyes });
    assert.deepEqual(generateFaceV3('catalog-fixture', definition.family, { seed: 7, personality, inheritedEyes }), result);
    assert.deepEqual(result.eyePair, inheritedEyes);
    assert.equal(generatedFaceV3Schema.safeParse(result).success, true);
    for (const face of Object.values(result.renderings!.compact!).flat()) {
      assert.ok([...face].length <= 6);
      assert.ok(face.includes(inheritedEyes[0]) && face.includes(inheritedEyes[1]));
    }
    const template = definition.templates.find(value => value.id === result.templateId)!;
    if (template.capabilities.builtInAppendages) assert.deepEqual(result.layers.gesture, template.builtInGesture);
    if (definition.family === 'cat') assert.deepEqual(result.layers.facialMarks, ['=', '=']);
    if (definition.family === 'minimal') assert.equal(result.layers.gesture, undefined);
  }
});
test('fixed catalog golden idle faces', () => {
  assert.deepEqual(FAMILY_DEFINITIONS.map(definition => generateFaceV3('catalog-fixture', definition.family, { seed: 7 }).base.idle), ['┐（¬‿¬）┌✦', '┐ʕ˙˘ω˘˙ʔ┌✦', '┐˙[¬−¬]˙┌*', '┐（==ﻌ==）┌✦', '‹·‿·›⁎']);
});


test('saved profiles and activity resolver preserve eyes and honor phase/static controls', () => {
  const identity = generateFaceV3('activity', 'cat');
  const compact = identity.renderings!.compact!;
  assert.equal(renderFace(identity, { profile: 'compact' }), compact.idle);
  assert.deepEqual(resolveFaceDisplay(identity.base.idle, { generated: identity, profile: 'compact', state: 'waiting', activityStyle: 'markers' }), { displayed: compact.idle, marker: '?' });
  assert.equal(renderFace(identity, { state: 'running', animation: false, elapsed: 750 }), identity.base.running);
  for (const state of ['waiting', 'error'] as const) assert.equal(renderFace(identity, { state, animation: true, elapsed: 999999 }), identity.base[state]);
  assert.equal(renderFace(identity, { state: 'running', animation: true, elapsed: 0 }), identity.base.runningFrames![Math.floor(identity.blinkOffset / 750) % 2]);
  assert.throws(() => renderFace(identity, { glyphProfile: 'ascii' }), UnsupportedFaceProfileError);
  const incomplete = structuredClone(identity); delete incomplete.renderings;
  assert.throws(() => renderFace(incomplete, { profile: 'compact' }), UnsupportedFaceProfileError);
});
test('fresh ASCII profiles are printable and inherit entire supported ASCII eye pairs', () => {
  for (const definition of FAMILY_DEFINITIONS) {
    const identity = generateFaceV3('ascii', definition.family, { glyphProfile: 'ascii' });
    assert.equal(generatedFaceV3Schema.safeParse(identity).success, true);
    const child = generateFaceV3('ascii-child', definition.family, { glyphProfile: 'ascii', inheritedEyes: identity.eyePair });
    assert.deepEqual(child.eyePair, identity.eyePair);
    for (const snapshot of [identity.base, identity.renderings!.ascii!.compact, identity.renderings!.ascii!.expressive!]) {
      for (const text of Object.values(snapshot).flat()) assert.match(text, /^[ -~]+$/);
    }
    assert.equal(renderFace(identity, { glyphProfile: 'ascii', profile: 'compact' }), identity.renderings!.ascii!.compact.idle);
  }
});
test('variation copies all locked resolved traits from snapshots including retired template IDs', () => {
  for (const definition of FAMILY_DEFINITIONS) {
    const identity = generateFaceV3('locked', definition.family); identity.templateId = 'retired-template';
    const next = varyFaceV3(identity, 91, { locks: { outline: true, eyes: true, mouth: true, accessory: true } });
    for (const key of ['outline', 'eyePair', 'mouth', 'accessory', 'layers', 'capabilities', 'templateId', 'personality'] as const) assert.deepEqual(next[key], identity[key]);
    assert.deepEqual(next.base, identity.base);
    assert.equal(generatedFaceV3Schema.safeParse(next).success, true);
  }
});


test('v3 status markers stay visible on idle-equal frames and ASCII markers remain printable', () => {
  for (const glyphProfile of ['unicode', 'ascii'] as const) {
    const identity = generateFaceV3('marker', 'robot', { glyphProfile });
    const idleFrameTime = (750 - identity.blinkOffset % 750 + 750 * (Math.floor(identity.blinkOffset / 750) % 2 === 0 ? 0 : 1));
    for (const activityStyle of ['markers', 'expressions'] as const) {
      for (const state of ['running', 'waiting', 'error'] as const) {
        const display = resolveFaceDisplay(identity.base.idle, { generated: identity, state, profile: 'compact', glyphProfile, activityStyle, animation: true, elapsed: idleFrameTime });
        assert.equal(display.marker, state === 'running' ? glyphProfile === 'ascii' ? '.' : '·' : state === 'waiting' ? '?' : '!');
        assert.ok([...display.displayed + display.marker].length <= 6);
        if (glyphProfile === 'ascii') assert.match(display.displayed + display.marker, /^[ -~]+$/);
      }
    }
    const wide = structuredClone(identity); wide.renderings!.compact!.running = '123456';
    assert.throws(() => resolveFaceDisplay(wide.base.idle, { generated: wide, state: 'running', profile: 'compact' }), UnsupportedFaceProfileError);
  }
});
test('locked layer compatibility checks every forbidden slot and built-in absence', () => {
  for (const kind of ['gesture', 'facialMarks', 'surroundings'] as const) {
    const candidate = { capabilities: { builtInAppendages: kind === 'gesture', allowedLayers: [] }, layers: { [kind]: ['L', 'R'] as [string, string] } };
    assert.doesNotThrow(() => assertLockedLayerCompatibility(candidate, { [kind]: ['L', 'R'] }));
    assert.throws(() => assertLockedLayerCompatibility(candidate, { [kind]: ['X', 'Y'] }), CatalogVariationConflictError);
    assert.throws(() => assertLockedLayerCompatibility(candidate, {}), CatalogVariationConflictError);
    assert.throws(() => assertLockedLayerCompatibility({ ...candidate, layers: {} }, { [kind]: ['L', 'R'] }), CatalogVariationConflictError);
    assert.doesNotThrow(() => assertLockedLayerCompatibility({ ...candidate, capabilities: { ...candidate.capabilities, allowedLayers: [kind] } }, { [kind]: ['X', 'Y'] }));
  }
});


test('missing compact profiles are accepted only for fully marker-safe saved bases', () => {
  const identity = generateFaceV3('missing-compact', 'cat');
  delete identity.renderings;
  assert.equal(generatedFaceV3Schema.safeParse(identity).success, false);
  identity.base = { idle: '(o_o)', running: '(o~o)', waiting: '(ooo)', error: '(o-o)', runningFrames: ['(o~o)', '(o_o)'] };
  assert.equal(generatedFaceV3Schema.safeParse(identity).success, true);
  assert.equal(renderFace(identity, { profile: 'compact' }), '(o_o)');
  identity.base.runningFrames![1] = '(o_o)!';
  assert.equal(generatedFaceV3Schema.safeParse(identity).success, false);
});

test('explicit eyes unlock overrides close resemblance while an omitted lock keeps its default', () => {
  const current = generateFaceV3('unlock-eyes', 'classic');
  assert.deepEqual(current.eyePair, ['^', '^']);
  const changed = varyFaceV3(current, 1, { locks: { eyes: false }, resemblance: 'close', threadId: 'unlock-eyes' });
  assert.deepEqual(changed.eyePair, ['•', '•']);
  assert.deepEqual(varyFaceV3(current, 1, { resemblance: 'close', threadId: 'unlock-eyes' }).eyePair, current.eyePair);
  assert.deepEqual(varyFaceV3(current, 1, { locks: { eyes: true }, resemblance: 'wide', threadId: 'unlock-eyes' }).eyePair, current.eyePair);
});

test('new compact snapshots simplify the wide wave while expressive and locked raw mouths persist', () => {
  const identity = generateFaceV3('compact-wave', 'classic', { seed: 3 });
  assert.equal(identity.mouth, '﹏');
  assert.ok(identity.base.idle.includes('﹏'));
  const compact = identity.renderings!.compact!;
  for (const text of Object.values(compact).flat()) assert.equal(text.includes('﹏'), false);
  assert.ok(compact.idle.includes('~'));
  assert.ok(compact.error.includes('~'));
  assert.deepEqual(identity.renderings!.expressive, identity.base);
  const changed = varyFaceV3(identity, 4, { locks: { outline: true, mouth: true } });
  assert.equal(changed.mouth, '﹏');
  assert.ok(changed.base.idle.includes('﹏'));
  assert.ok(changed.renderings!.compact!.idle.includes('~'));
  const saved = structuredClone(identity);
  saved.renderings!.compact!.idle = saved.renderings!.compact!.idle.replace('~', '﹏');
  assert.equal(renderFace(saved, { profile: 'compact' }), saved.renderings!.compact!.idle);
  assert.ok(renderFace(saved, { profile: 'compact' }).includes('﹏'));
  // Variation understands pre-simplification geometry without changing the saved read.
  assert.equal(varyFaceV3(saved, 4, { locks: { outline: true, mouth: true } }).mouth, '﹏');
});
