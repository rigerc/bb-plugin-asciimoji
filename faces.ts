import { z } from 'zod';

export const FACES = [
  { name: 'Happy', face: '(＾▽＾)' },
  { name: 'Cat', face: '(=^･ω･^=)' },
  { name: 'Cool', face: '(⌐■_■)' },
  { name: 'Curious', face: '(・・?)' },
  { name: 'Wave', face: '(｡･ω･)ﾉ' },
  { name: 'Determined', face: '(ง •̀_•́)ง' },
  { name: 'Cozy', face: '(˘◡˘)' },
  { name: 'Sparkle', face: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧' },
  { name: 'Bear', face: 'ʕ•ᴥ•ʔ' },
  { name: 'Cheer', face: '\\(^o^)/' },
  { name: 'Classic', face: ':-)' },
  { name: 'Robot', face: '[o_o]' },
] as const;

export const FAMILY_IDS = ['classic', 'bear', 'robot', 'cat', 'minimal'] as const;
export type FaceFamily = typeof FAMILY_IDS[number];
export const FACE_FAMILIES: { id: FaceFamily; name: string }[] = [
  { id: 'classic', name: 'Classic' },
  { id: 'bear', name: 'Bears' },
  { id: 'robot', name: 'Robots' },
  { id: 'cat', name: 'Cats' },
  { id: 'minimal', name: 'Minimal' },
];
const familyParts = {
  bear: { ears: ['ʕ', 'ʔ'], eyes: ['•', '^', 'o', '˘'], mouths: ['ᴥ', 'ω'] },
  robot: { ears: ['[', ']'], eyes: ['o', '•', '°', '¬'], mouths: ['_', '−', '='] },
  cat: { ears: ['(', ')'], eyes: ['^', '˘', '•', '='], mouths: ['ω'] },
  minimal: { ears: ['(', ')'], eyes: ['•', '･', '˘', '·'], mouths: ['_', '‿', 'ᴗ'] },
} as const;

// Stable across processes and clients; never depends on a title or provider.
export function defaultFace(threadId: string, family: FaceFamily = 'classic'): string {
  return renderFace(generateFace(threadId, family));
}

export type FaceState = 'idle' | 'running' | 'waiting' | 'error';
export type FaceExpressions = Partial<Record<Exclude<FaceState, 'idle'>, string>>;
export type ActivityStyle = 'expressions' | 'markers';
export type SidebarWidth = 'compact' | 'standard' | 'expanded';
export const SIDEBAR_WIDTHS: Record<SidebarWidth, string> = { compact: '6ch', standard: '10ch', expanded: '16ch' };
export function activityMarker(state: FaceState, glyphProfile: FaceGlyphProfile = 'unicode'): string {
  return state === 'running' ? (glyphProfile === 'ascii' ? '.' : '·') : state === 'waiting' ? '?' : state === 'error' ? '!' : '';
}
export type FaceDisplayProfile = 'compact' | 'expressive';
export type FaceGlyphProfile = 'unicode' | 'ascii';
export class UnsupportedFaceProfileError extends Error { readonly code = 'UNSUPPORTED_FACE_PROFILE'; }
export interface ResolvedFaceDisplay { displayed: string; marker: string; }
/** Centralize activity presentation so headers, sidebar faces, and picker previews agree.
 * - Activity off (state undefined): static base face.
 * - Markers: static base face plus a status marker.
 * - Expressions: v3 state expression plus a stable status marker; v2 keeps its
 *   original behavior. Custom expressions use marker fallback when unavailable.
 * - The schema admits six-codepoint compact snapshots for sizing; active v3
 *   display requires five core codepoints to reserve the marker slot. */
export function resolveFaceDisplay(face: string, options: {
  generated?: GeneratedFace; expressions?: FaceExpressions; state?: FaceState;
  activityStyle?: ActivityStyle; elapsed?: number; animation?: boolean;
  profile?: FaceDisplayProfile; glyphProfile?: FaceGlyphProfile;
} = {}): ResolvedFaceDisplay {
  const { generated, expressions, state, activityStyle = 'expressions', elapsed = 0, animation = false } = options;
  const baseFace = generated && (generated.version === 3 || options.glyphProfile === 'ascii') ? renderFace(generated, { profile: options.profile, glyphProfile: options.glyphProfile }) : face;
  if (!state || state === 'idle') return { displayed: baseFace, marker: '' };
  if (activityStyle === 'markers') {
    if (generated?.version === 3 && options.profile === 'compact' && countFaceCharacters(baseFace) > 5) throw new UnsupportedFaceProfileError('This compact profile has no room for an activity marker.');
    return { displayed: baseFace, marker: activityMarker(state, options.glyphProfile) };
  }
  if (generated) {
    const displayed = renderFace(generated, { state, elapsed, animation, profile: options.profile, glyphProfile: options.glyphProfile });
    if (generated.version === 3 && options.profile === 'compact' && countFaceCharacters(displayed) > 5) throw new UnsupportedFaceProfileError('This compact profile has no room for an activity marker.');
    return { displayed, marker: generated.version === 3 ? activityMarker(state, options.glyphProfile) : '' };
  }
  const custom = expressions?.[state];
  if (custom) return { displayed: custom, marker: '' };
  return { displayed: face, marker: activityMarker(state, options.glyphProfile) };
}
export const countFaceCharacters = (value: string) => [...value].length;
/** Shared by the editor and RPC boundary; limits count Unicode code points. */
export function faceValidationError(value: string): string | null {
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return 'Use one line without control or invisible formatting characters.';
  const trimmed = value.trim();
  if (!trimmed || /^[\s\p{M}\u2800\u3164\u115f\u1160\uffa0]+$/u.test(trimmed)) return 'Enter a visible face.';
  if (countFaceCharacters(trimmed) > 40) return 'Use 40 characters or fewer.';
  return null;
}
export interface GeneratedFaceV2 {
  version: 2;
  family: FaceFamily;
  ears: [string, string];
  eyes: string;
  mouth: string;
  blinkOffset: number;
  accessory?: string;
}

export const PERSONALITIES = ['calm', 'cheerful', 'curious'] as const;
export const LAYER_IDS = ['gesture', 'facialMarks', 'surroundings'] as const;
const glyph = z.string().refine(value => countFaceCharacters(value) <= 4 && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value));
const pair = z.tuple([glyph, glyph]);
const snapshotText = (max: number) => z.string().refine(value => faceValidationError(value) === null && countFaceCharacters(value) <= max);
export const renderingSnapshotSchema = z.object({
  idle: snapshotText(40), running: snapshotText(40), waiting: snapshotText(40), error: snapshotText(40),
  runningFrames: z.array(snapshotText(40)).min(1).max(4).optional(),
}).strict();
const compactRenderingSchema = z.object({
  idle: snapshotText(6), running: snapshotText(6), waiting: snapshotText(6), error: snapshotText(6),
  runningFrames: z.array(snapshotText(6)).min(1).max(4).optional(),
}).strict();
const asciiRendering = (schema: typeof renderingSnapshotSchema | typeof compactRenderingSchema) => schema.refine(value =>
  [value.idle, value.running, value.waiting, value.error, ...(value.runningFrames ?? [])].every(text => /^[ -~]+$/.test(text)));
export const generatedFaceV2Schema = z.object({
  version: z.literal(2), family: z.enum(FAMILY_IDS), ears: z.tuple([z.string().length(1), z.string().length(1)]),
  eyes: z.string().length(1), mouth: z.string().length(1), blinkOffset: z.number().int().min(0).max(3999), accessory: z.string().length(1).optional(),
});
export const generatedFaceV3Schema = z.object({
  version: z.literal(3), family: z.enum(FAMILY_IDS), templateId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(64),
  personality: z.enum(PERSONALITIES), outline: pair, eyePair: pair, mouth: glyph, accessory: glyph.optional(),
  layers: z.object({ gesture: pair.optional(), facialMarks: pair.optional(), surroundings: pair.optional() }).strict(),
  capabilities: z.object({ builtInAppendages: z.boolean(), allowedLayers: z.array(z.enum(LAYER_IDS)).max(3).refine(value => new Set(value).size === value.length) }).strict(),
  blinkOffset: z.number().int().min(0).max(3999), base: renderingSnapshotSchema,
  renderings: z.object({ compact: compactRenderingSchema.optional(), expressive: renderingSnapshotSchema.optional(),
    ascii: z.object({ compact: asciiRendering(compactRenderingSchema), expressive: asciiRendering(renderingSnapshotSchema).optional() }).strict().optional(),
  }).strict().optional(),
}).strict().refine(identity => identity.renderings?.compact !== undefined ||
  [identity.base.idle, identity.base.running, identity.base.waiting, identity.base.error, ...(identity.base.runningFrames ?? [])].every(text => countFaceCharacters(text) <= 5),
{ message: 'A saved compact profile is required unless every base state and frame fits five codepoints with marker space.' });
export const generatedFaceSchema = z.discriminatedUnion('version', [generatedFaceV2Schema, generatedFaceV3Schema]);
export type GeneratedFaceV3 = z.infer<typeof generatedFaceV3Schema>;
export type GeneratedFace = GeneratedFaceV2 | GeneratedFaceV3;
/** FNV-1a over UTF-8, independently named traits prevent catalog changes coupling selections. */
export function namedTraitHash(threadId: string, seed: number, trait: string): number {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(`${threadId}:${seed}:v3:${trait}`)) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}
export interface WeightedEntry<T> { value: T; weight: number; }
/** Ordered cumulative selection; ticket is a uint32 and intervals are half-open. */
export function orderedWeightedSelect<T>(entries: readonly WeightedEntry<T>[], ticket: number): T {
  if (!Number.isInteger(ticket) || ticket < 0 || ticket > 0xffffffff) throw new Error('Expected a uint32 ticket');
  const total = entries.reduce((sum, entry) => {
    if (!Number.isSafeInteger(entry.weight) || entry.weight < 0) throw new Error('Weights must be nonnegative safe integers');
    return sum + entry.weight;
  }, 0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('Expected a positive safe total weight');
  const target = ticket / 0x100000000 * total;
  let cumulative = 0;
  for (const entry of entries) { cumulative += entry.weight; if (target < cumulative) return entry.value; }
  throw new Error('Invalid weighted palette');
}

function identityHash(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Single current generator. Saved identities are snapshots; children may inherit resolved parent eyes. */
export function generateFace(threadId: string, family: FaceFamily = 'classic', options: {
  seed?: number; inheritedEyes?: string;
} = {}): GeneratedFaceV2 {
  const hash = identityHash(`${threadId}:${options.seed ?? 0}:v2`);
  const parts = family === 'classic' ? undefined : familyParts[family];
  const ears = parts?.ears ?? [['(', ')'], ['ʕ', 'ʔ'], ['[', ']'], ['{', '}']][hash % 4]!;
  const eyes = parts?.eyes ?? ['•', '^', 'o', '¬'];
  const mouths = family === 'bear' ? ['ᴥ', 'ω', 'ᴗ', 'ᵕ', '‿', 'ﻌ']
    : family === 'robot' ? ['_', '−', '=', '‿', 'ᴗ', '﹏']
    : family === 'cat' ? ['ω', 'ﻌ', 'ᵕ', 'ᴗ', '﹏', '‿']
    : ['_', '‿', 'ᴗ', 'ω', 'ᵕ', '﹏'];
  const accessories = family === 'minimal' ? ['·', '˙', '°', '˖', '˳', '⁺', '⁎', '∙']
    : ['✧', '♡', '☆', '♪', '✿', '☼', '✦', '⁎'];
  return {
    version: 2, family, ears: [ears[0], ears[1]],
    eyes: options.inheritedEyes ?? eyes[(hash >>> 4) % eyes.length]!,
    mouth: mouths[(hash >>> 8) % mouths.length]!,
    accessory: accessories[(hash >>> 16) % accessories.length]!,
    blinkOffset: (hash >>> 12) % 4000,
  };
}

/** Each identity retains its glyph count across expressions; time is supplied by the caller.
 * Only the running state animates; idle, waiting and error are always static. */
export function renderFace(identity: GeneratedFace, options: {
  state?: FaceState; elapsed?: number; animation?: boolean;
  profile?: FaceDisplayProfile; glyphProfile?: FaceGlyphProfile;
} = {}): string {
  const { state = 'idle', elapsed = 0, animation = false } = options;
  if (identity.version === 3) {
    const profile = options.profile ?? 'expressive';
    let snapshot;
    if (options.glyphProfile === 'ascii') {
      const ascii = identity.renderings?.ascii;
      snapshot = profile === 'compact' ? ascii?.compact : ascii?.expressive;
      if (!snapshot) throw new UnsupportedFaceProfileError('This character has no saved ASCII profile. Generate a new ASCII character.');
    } else {
      snapshot = identity.renderings?.[profile];
      if (!snapshot && profile === 'compact') {
        const texts = [identity.base.idle, identity.base.running, identity.base.waiting, identity.base.error, ...(identity.base.runningFrames ?? [])];
        if (!texts.every(text => countFaceCharacters(text) <= 5)) throw new UnsupportedFaceProfileError('This character has no saved compact profile.');
      }
      snapshot ??= identity.base;
    }
    const frames = snapshot.runningFrames;
    const phase = Math.floor((Math.max(0, elapsed) + identity.blinkOffset) / 750);
    return state === 'running' && animation && frames?.length ? frames[phase % frames.length]! : snapshot[state];
  }
  if (options.glyphProfile === 'ascii') throw new UnsupportedFaceProfileError('This character has no saved ASCII profile. Generate a new ASCII character.');
  let eyes = identity.eyes;
  if (state === 'error') eyes = 'x';
  else if (state === 'waiting') eyes = '?';
  else if (state === 'running') eyes = animation && Math.floor(elapsed / 750) % 2 ? '>' : '<';
  return `${identity.ears[0]}${eyes}${identity.mouth}${eyes}${identity.ears[1]}${identity.accessory ?? ''}`;
}
