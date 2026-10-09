import { namedTraitHash, orderedWeightedSelect, type FaceFamily, type GeneratedFaceV3 } from './faces';

/** Independently curated common text-face glyphs. No upstream catalog or code
 * was copied/adapted; template/palette/layer concepts follow IMPLEMENTATION_PLAN.
 * Array order and IDs are part of the deterministic generator contract. */
export const CATALOG_PROVENANCE = 'Independent common-glyph curation; no upstream code or palette content.';
export const PERSONALITIES = ['calm', 'cheerful', 'curious'] as const;
export type CatalogPersonality = typeof PERSONALITIES[number];
export type GlyphPair = [string, string];
export interface WeightedTrait<T> { id: string; value: T; weight: number; personalities: readonly CatalogPersonality[]; }
export interface TemplateCapabilities {
  builtInAppendages: boolean;
  gesture: boolean;
  facialMarks: boolean;
  surroundings: boolean;
  compactFits: boolean;
}
export interface CatalogTemplate {
  id: string; weight: number; personalities: readonly CatalogPersonality[];
  outline: GlyphPair; compactOutline: GlyphPair;
  builtInGesture?: GlyphPair; builtInFacialMarks?: GlyphPair;
  capabilities: TemplateCapabilities;
}
export type CatalogLayerKind = 'gesture' | 'facialMarks' | 'surroundings';
export interface CatalogLayerPalette { probability: number; candidates: readonly WeightedTrait<GlyphPair>[]; }
export interface FamilyDefinition {
  family: FaceFamily; templates: readonly CatalogTemplate[];
  eyes: readonly WeightedTrait<GlyphPair>[];
  mouths: readonly WeightedTrait<string>[];
  accessories: { probability: number; candidates: readonly WeightedTrait<string>[] };
  layers: Record<CatalogLayerKind, CatalogLayerPalette>;
}
const all = PERSONALITIES;
const trait = <T>(id: string, value: T, weight = 1, personalities: readonly CatalogPersonality[] = all): WeightedTrait<T> => ({ id, value, weight, personalities });
const pair = (left: string, right = left): GlyphPair => [left, right];
const templates = (family: FaceFamily, outlines: GlyphPair[], compact: GlyphPair, marks?: GlyphPair): CatalogTemplate[] => outlines.map((outline, index) => ({
  id: `${family}-${index + 1}`, weight: index === 0 ? 2 : 1, personalities: all,
  outline, compactOutline: outline.every(part => [...part].length === 1 && !/[（ ）〔〕]/u.test(part)) ? [...outline] : [...compact],
  ...(marks ? { builtInFacialMarks: marks } : {}),
  ...(index === 3 && family !== 'minimal' ? { builtInGesture: pair('┐', '┌') } : {}),
  capabilities: { builtInAppendages: index === 3 && family !== 'minimal', gesture: index !== 3 && family !== 'minimal', facialMarks: !marks, surroundings: family !== 'minimal', compactFits: true },
}));
const eyes = (glyphs: string[]): WeightedTrait<GlyphPair>[] => [
  ...glyphs.map((glyph, i) => trait(`eyes-${i + 1}`, pair(glyph), i === 0 ? 2 : 1)),
  trait('eyes-wink', pair(glyphs[0]!, '˘'), 1, ['cheerful', 'curious']),
];
const mouths = (glyphs: string[]): WeightedTrait<string>[] => glyphs.map((glyph, i) => trait(`mouth-${i + 1}`, glyph));
const accessories = (glyphs: string[]) => ({ probability: 0.55, candidates: glyphs.map((glyph, i) => trait(`accessory-${i + 1}`, glyph)) });
const layerPalette = (probability: number, candidates: WeightedTrait<GlyphPair>[]): CatalogLayerPalette => ({ probability, candidates });
const expressiveLayers = (): FamilyDefinition['layers'] => ({
  gesture: layerPalette(0.3, [trait('wave', pair('', 'ﾉ'), 2, ['cheerful', 'curious']), trait('raised', pair('╰', '╯')), trait('resting', pair('ノ', 'ヽ'), 1, ['calm'])]),
  facialMarks: layerPalette(0.25, [trait('blush', pair('˙')), trait('freckles', pair('･'))]),
  surroundings: layerPalette(0.2, [trait('sparkles', pair('✧')), trait('hearts', pair('♡'), 1, ['cheerful']), trait('dots', pair('·'), 2, ['calm', 'curious'])]),
});
const minimalLayers = (): FamilyDefinition['layers'] => ({ gesture: layerPalette(0, []), facialMarks: layerPalette(0.15, [trait('dots', pair('·'))]), surroundings: layerPalette(0, []) });
export const FAMILY_DEFINITIONS: readonly FamilyDefinition[] = [
  { family: 'classic', templates: templates('classic', [pair('(', ')'), pair('{', '}'), pair('〔', '〕'), pair('（', '）')], pair('(', ')')), eyes: eyes(['•', '^', 'o', '¬']), mouths: mouths(['_', '‿', 'ᴗ', 'ω', 'ᵕ', '﹏']), accessories: accessories(['✧', '♡', '☆', '♪', '✿', '☼', '✦', '⁎']), layers: expressiveLayers() },
  { family: 'bear', templates: templates('bear', [pair('ʕ', 'ʔ'), pair('ʕᵔ', 'ᵔʔ'), pair('ʕ·', '·ʔ'), pair('ʕ˙', '˙ʔ')], pair('ʕ', 'ʔ')), eyes: eyes(['•', '^', 'o', '˘']), mouths: mouths(['ᴥ', 'ω', 'ᴗ', 'ᵕ', '‿', 'ﻌ']), accessories: accessories(['✧', '♡', '☆', '♪', '✿', '☼', '✦', '⁎']), layers: expressiveLayers() },
  { family: 'robot', templates: templates('robot', [pair('[', ']'), pair('⌈', '⌉'), pair('┌[', ']┐'), pair('˙[', ']˙')], pair('[', ']')), eyes: eyes(['o', '•', '°', '¬']), mouths: mouths(['_', '−', '=', '‿', 'ᴗ', '﹏']), accessories: accessories(['✧', '⁎', '+', '·', '°', '⌁', '*', '˙']), layers: expressiveLayers() },
  { family: 'cat', templates: templates('cat', [pair('(', ')'), pair('₍', '₎'), pair('⟨', '⟩'), pair('（', '）')], pair('(', ')'), pair('=')), eyes: eyes(['^', '˘', '•', '=']), mouths: mouths(['ω', 'ﻌ', 'ᵕ', 'ᴗ', '﹏', '‿']), accessories: accessories(['✧', '♡', '☆', '♪', '✿', '☼', '✦', '⁎']), layers: expressiveLayers() },
  { family: 'minimal', templates: templates('minimal', [pair('(', ')'), pair('[', ']'), pair('{', '}'), pair('‹', '›')], pair('(', ')')), eyes: eyes(['•', '･', '˘', '·']), mouths: mouths(['_', '‿', 'ᴗ', 'ᵕ', '-', 'o']), accessories: accessories(['·', '˙', '°', '˖', '˳', '⁺', '⁎', '∙']), layers: minimalLayers() },
];
export interface CatalogComposition {
  outline: GlyphPair; eyePair: GlyphPair; mouth: string; accessory?: string;
  layers: Partial<Record<CatalogLayerKind, GlyphPair>>;
}
/** Outside-in, with matching right parts in reverse nesting order. */
export function composeCatalogFace(parts: CatalogComposition): string {
  const { surroundings: s = pair(''), gesture: g = pair(''), facialMarks: f = pair('') } = parts.layers;
  return `${s[0]}${g[0]}${parts.outline[0]}${f[0]}${parts.eyePair[0]}${parts.mouth}${parts.eyePair[1]}${f[1]}${parts.outline[1]}${g[1]}${parts.accessory ?? ''}${s[1]}`;
}
export function compatibleTraits<T extends { personalities: readonly CatalogPersonality[] }>(traits: readonly T[], personality: CatalogPersonality): T[] {
  return traits.filter(value => value.personalities.includes(personality));
}
export function supportedInheritedEyes(definition: FamilyDefinition, inherited: GlyphPair | undefined): GlyphPair | undefined {
  return inherited && definition.eyes.some(({ value }) => value[0] === inherited[0] && value[1] === inherited[1]) ? [...inherited] : undefined;
}
export function validateFamilyDefinitions(definitions: readonly FamilyDefinition[] = FAMILY_DEFINITIONS): string[] {
  const errors: string[] = [];
  const families = new Set<string>();
  for (const definition of definitions) {
    const prefix = definition.family;
    if (families.has(prefix)) errors.push(`${prefix}: duplicate family`);
    families.add(prefix);
    const pools = [definition.templates, definition.eyes, definition.mouths, definition.accessories.candidates, ...Object.values(definition.layers).map(layer => layer.candidates)];
    for (const pool of pools) {
      const ids = new Set<string>(); const patterns = new Set<string>(); let total = 0;
      for (const value of pool) {
        if (ids.has(value.id)) errors.push(`${prefix}: duplicate ${value.id}`);
        ids.add(value.id);
        if ('value' in value) {
          const pattern = JSON.stringify(value.value);
          if (patterns.has(pattern)) errors.push(`${prefix}: duplicate glyph pattern ${value.id}`);
          patterns.add(pattern);
        }
        if (!Number.isSafeInteger(value.weight) || value.weight <= 0) errors.push(`${prefix}: invalid weight ${value.id}`);
        total += value.weight;
        if (!value.personalities.length || value.personalities.some(p => !PERSONALITIES.includes(p))) errors.push(`${prefix}: invalid personality ${value.id}`);
      }
      if (!Number.isFinite(total)) errors.push(`${prefix}: invalid total weight`);
    }
    for (const layer of [definition.accessories, ...Object.values(definition.layers)]) {
      if (!Number.isFinite(layer.probability) || layer.probability < 0 || layer.probability > 1) errors.push(`${prefix}: invalid inclusion probability`);
      if (layer.probability > 0 && !layer.candidates.length) errors.push(`${prefix}: empty enabled layer`);
    }
    for (const personality of PERSONALITIES) for (const pool of [definition.templates, definition.eyes, definition.mouths]) {
      if (!pool.some(value => value.personalities.includes(personality))) errors.push(`${prefix}: empty required pool for ${personality}`);
    }
    for (const template of definition.templates) {
      if (template.capabilities.builtInAppendages && template.capabilities.gesture) errors.push(`${prefix}: duplicate appendage capability`);
      const compact = composeCatalogFace({ outline: template.compactOutline, eyePair: pair('•'), mouth: '_', layers: {} });
      if ([...compact].length > 5) errors.push(`${prefix}: compact must reserve marker space`);
    }
  }
  return errors;
}

export class CatalogGenerationError extends Error { readonly code = 'CATALOG_UNAVAILABLE'; }
/** Callers resolve same-family ancestry before passing a parent's complete pair. */
export function generateFaceV3(threadId: string, family: FaceFamily = 'classic', options: {
  seed?: number; inheritedEyes?: GlyphPair; personality?: CatalogPersonality; glyphProfile?: 'unicode' | 'ascii';
} = {}): GeneratedFaceV3 {
  const definition = FAMILY_DEFINITIONS.find(value => value.family === family);
  if (!definition) throw new CatalogGenerationError(`No catalog for ${family}`);
  const hash = (name: string) => namedTraitHash(threadId, options.seed ?? 0, name);
  const personality = options.personality ?? PERSONALITIES[hash('personality') % PERSONALITIES.length]!;
  const choose = <T extends { weight: number; personalities: readonly CatalogPersonality[] }>(pool: readonly T[], name: string): T => {
    const compatible = compatibleTraits(pool, personality);
    if (!compatible.length) throw new CatalogGenerationError(`No compatible ${name} for ${family}/${personality}`);
    return orderedWeightedSelect(compatible.map(value => ({ value, weight: value.weight })), hash(`${name}:choice`));
  };
  const include = (probability: number, name: string) => probability > 0 && hash(`${name}:include`) / 0x100000000 < probability;
  const template = choose(definition.templates, 'template');
  const inherited = supportedInheritedEyes(definition, options.inheritedEyes) ?? (options.glyphProfile === 'ascii' && options.inheritedEyes && definition.eyes.some(({ value }) => value.map(asciiGlyph).every((glyph, index) => glyph === options.inheritedEyes![index])) ? [...options.inheritedEyes] as GlyphPair : undefined);
  const eyePair = inherited ?? [...choose(definition.eyes, 'eyes').value] as GlyphPair;
  const mouth = choose(definition.mouths, 'mouth').value;
  const accessory = include(definition.accessories.probability, 'accessory') ? choose(definition.accessories.candidates, 'accessory').value : undefined;
  const layers: CatalogComposition['layers'] = {};
  for (const kind of ['gesture', 'facialMarks', 'surroundings'] as const) {
    const palette = definition.layers[kind];
    if (template.capabilities[kind] && include(palette.probability, kind)) layers[kind] = [...choose(palette.candidates, kind).value];
  }
  if (template.builtInGesture) layers.gesture = [...template.builtInGesture];
  if (template.builtInFacialMarks) layers.facialMarks = [...template.builtInFacialMarks];
  const identity: GeneratedFaceV3 = {
    version: 3, family, templateId: template.id, personality, outline: [...template.outline], eyePair, mouth,
    ...(accessory === undefined ? {} : { accessory }), layers,
    capabilities: { builtInAppendages: template.capabilities.builtInAppendages, allowedLayers: (['gesture', 'facialMarks', 'surroundings'] as const).filter(kind => template.capabilities[kind]) },
    blinkOffset: hash('blinkOffset') % 4000, base: { idle: '', running: '', waiting: '', error: '' },
  };
  return snapshotCatalogIdentity(identity, template.compactOutline, options.glyphProfile ?? 'unicode');
}


const ASCII_GLYPHS: Record<string, string> = {
  '•': 'o', '^': '^', 'o': 'o', '¬': '-', '˘': '-', '°': 'o', '･': '.', '·': '.',
  'ʕ': '(', 'ʔ': ')', 'ᵔ': '^', '˙': '.', '⌈': '[', '⌉': ']', '┌': '+', '┐': '+',
  '₍': '(', '₎': ')', '⟨': '<', '⟩': '>', '（': '(', '）': ')', '〔': '[', '〕': ']', '‹': '<', '›': '>',
  'ᴥ': 'w', 'ω': 'w', 'ᴗ': 'u', 'ᵕ': 'u', '‿': '_', 'ﻌ': 'w', '−': '-', '﹏': '~',
  '✧': '*', '♡': '<3', '☆': '*', '♪': '~', '✿': '*', '☼': '*', '✦': '+', '⁎': '*',
  '˖': '+', '˳': '.', '⁺': '+', '∙': '.', '⌁': '~', 'ﾉ': '/', '╰': '/', '╯': '\\', 'ノ': '/', 'ヽ': '\\',
};
function asciiGlyph(value: string): string {
  return [...value].map(glyph => /^[ -~]$/.test(glyph) ? glyph : ASCII_GLYPHS[glyph] ?? '*').join('');
}
/** The BB sidebar font gives U+FE4F a wider cell; compact uses its ASCII wave. */
function compactMouth(value: string): string { return value.replaceAll('﹏', '~'); }
function snapshotCatalogIdentity(input: GeneratedFaceV3, compactOutline: GlyphPair, profile: 'unicode' | 'ascii'): GeneratedFaceV3 {
  const identity = structuredClone(input);
  if (profile === 'ascii') {
    identity.outline = identity.outline.map(asciiGlyph) as GlyphPair;
    identity.eyePair = identity.eyePair.map(asciiGlyph) as GlyphPair;
    identity.mouth = asciiGlyph(identity.mouth);
    if (identity.accessory !== undefined) identity.accessory = asciiGlyph(identity.accessory);
    for (const kind of ['gesture', 'facialMarks', 'surroundings'] as const) {
      if (identity.layers[kind]) identity.layers[kind] = identity.layers[kind]!.map(asciiGlyph) as GlyphPair;
    }
    compactOutline = compactOutline.map(asciiGlyph) as GlyphPair;
  }
  const { family, personality, mouth } = identity;
  const stateMouths: Record<FaceFamily, { running: string; waiting: string; error: string }> = {
    classic: { running: personality === 'calm' ? 'ᵕ' : 'ᴗ', waiting: 'o', error: '﹏' },
    bear: { running: personality === 'cheerful' ? 'ω' : 'ᴥ', waiting: 'ᵕ', error: '_' },
    robot: { running: personality === 'curious' ? '=' : '−', waiting: 'o', error: '_' },
    cat: { running: personality === 'calm' ? 'ﻌ' : 'ω', waiting: 'ᵕ', error: '﹏' },
    minimal: { running: personality === 'cheerful' ? 'ᴗ' : '−', waiting: 'o', error: '_' },
  };
  const compose = (compact: boolean, nextMouth: string) => composeCatalogFace({ outline: compact ? compactOutline : identity.outline, eyePair: identity.eyePair, mouth: profile === 'ascii' ? asciiGlyph(nextMouth) : compact ? compactMouth(nextMouth) : nextMouth, accessory: compact ? undefined : identity.accessory, layers: compact ? {} : identity.layers });
  const snapshots = (compact: boolean) => {
    const idle = compose(compact, mouth); const states = stateMouths[family];
    return { idle, running: compose(compact, states.running), waiting: compose(compact, states.waiting), error: compose(compact, states.error), runningFrames: [compose(compact, states.running), idle] };
  };
  const expressive = snapshots(false); const compact = snapshots(true);
  identity.base = expressive;
  identity.renderings = { compact, expressive, ...(profile === 'ascii' ? { ascii: { compact, expressive } } : {}) };
  return identity;
}
export class CatalogVariationConflictError extends CatalogGenerationError {}
/** Forbidden slots may contain a template's built-in parts. Locked glyphs must
 * match those parts exactly, including absence; allowed optional slots can vary. */
export function assertLockedLayerCompatibility(candidate: Pick<GeneratedFaceV3, 'capabilities' | 'layers'>, lockedLayers: GeneratedFaceV3['layers']): void {
  for (const kind of ['gesture', 'facialMarks', 'surroundings'] as const) {
    if (!candidate.capabilities.allowedLayers.includes(kind) && JSON.stringify(candidate.layers[kind]) !== JSON.stringify(lockedLayers[kind])) {
      throw new CatalogVariationConflictError(`Locked ${kind} conflicts with this template. Try another candidate or unlock decorations.`);
    }
  }
}
export type VariationLocks = { outline?: boolean; eyes?: boolean; mouth?: boolean; accessory?: boolean };
/** Locked resolved glyphs are copied from the saved snapshot, never looked up. */
export function varyFaceV3(current: GeneratedFaceV3, seed: number, options: { locks?: VariationLocks; resemblance?: 'close' | 'wide'; glyphProfile?: 'unicode' | 'ascii'; threadId?: string } = {}): GeneratedFaceV3 {
  const locks = options.locks ?? {};
  const currentProfile = current.renderings?.ascii ? 'ascii' : 'unicode';
  const glyphProfile = options.glyphProfile ?? currentProfile;
  if (glyphProfile !== currentProfile && Object.values(locks).some(Boolean)) throw new CatalogVariationConflictError('Changing glyph profiles requires unlocked traits.');
  const next = generateFaceV3(options.threadId ?? `${current.family}:${current.templateId}:variation`, current.family, { seed, personality: current.personality, glyphProfile });
  const generatedCompact = next.renderings!.compact!.idle;
  let compactOutline: GlyphPair = [[...generatedCompact][0]!, [...generatedCompact].at(-1)!];
  if (locks.outline) { next.templateId = current.templateId; next.outline = [...current.outline]; next.capabilities = structuredClone(current.capabilities); }
  if (locks.eyes || (options.resemblance === 'close' && locks.eyes !== false)) next.eyePair = [...current.eyePair];
  if (locks.mouth) next.mouth = current.mouth;
  if (locks.accessory) {
    if (!locks.outline) assertLockedLayerCompatibility(next, current.layers);
    if (current.accessory === undefined) delete next.accessory; else next.accessory = current.accessory;
    next.layers = structuredClone(current.layers);
  }
  // Built-in frame appendages/marks belong to the locked outline; prevent duplication.
  if (locks.outline && !locks.accessory) {
    for (const kind of ['gesture', 'facialMarks', 'surroundings'] as const) {
      if (!next.capabilities.allowedLayers.includes(kind)) {
        if (current.layers[kind]) next.layers[kind] = [...current.layers[kind]!]; else delete next.layers[kind];
      }
    }
  }
  if (locks.outline) {
    const compact = current.renderings?.compact?.idle ?? current.base.idle;
    const cores = [`${current.eyePair[0]}${compactMouth(current.mouth)}${current.eyePair[1]}`, `${current.eyePair[0]}${current.mouth}${current.eyePair[1]}`];
    const core = cores.find(value => compact.includes(value)) ?? cores[0]!;
    const start = compact.indexOf(core);
    if (start < 0) throw new CatalogGenerationError('Saved compact geometry cannot be varied with a locked outline.');
    compactOutline = [compact.slice(0, start), compact.slice(start + core.length)];
  }
  return snapshotCatalogIdentity(next, compactOutline, glyphProfile);
}
