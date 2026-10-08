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
export function defaultFace(threadId: string, parentThreadId?: string | null): string {
  return renderFace(generateFace(threadId, parentThreadId));
}

export type FaceState = 'idle' | 'running' | 'waiting' | 'error';
export type FaceExpressions = Partial<Record<Exclude<FaceState, 'idle'>, string>>;
export const countFaceCharacters = (value: string) => [...value].length;
/** Shared by the editor and RPC boundary; limits count Unicode code points. */
export function faceValidationError(value: string): string | null {
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return 'Use one line without control or invisible formatting characters.';
  const trimmed = value.trim();
  if (!trimmed || /^[\s\p{M}\u2800\u3164\u115f\u1160\uffa0]+$/u.test(trimmed)) return 'Enter a visible face.';
  if (countFaceCharacters(trimmed) > 40) return 'Use 40 characters or fewer.';
  return null;
}
export interface GeneratedFace {
  version: 1 | 2;
  family?: FaceFamily;
  ears: [string, string];
  eyes: string;
  mouth: string;
  blinkOffset: number;
  accessory?: string;
}

function identityHash(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Thread identity is deterministic; children share their parent's hash-selected eyes. */
export function generateFace(threadId: string, parentThreadId?: string | null, family: FaceFamily = 'classic'): GeneratedFace {
  const hash = identityHash(threadId);
  const eyeHash = identityHash(parentThreadId ?? threadId);
  const ears = [['(', ')'], ['ʕ', 'ʔ'], ['[', ']'], ['{', '}']] as const;
  const parts = family === 'classic' ? undefined : familyParts[family];
  const pair = parts?.ears ?? ears[hash % ears.length]!;
  const eyes = parts?.eyes ?? ['•', '^', 'o', '¬'];
  const mouths = parts?.mouths ?? ['ω', 'ᴥ', 'ᴗ', '‿'];
  return {
    version: 1,
    ...(family !== 'classic' ? { family } : {}),
    ears: [pair[0], pair[1]],
    eyes: eyes[(eyeHash >>> 4) % eyes.length]!,
    mouth: mouths[(hash >>> 8) % mouths.length]!,
    blinkOffset: (hash >>> 12) % 4000,
  };
}

/** V1 above is frozen for legacy saved choices. V2 saves its complete identity. */
export function generateFaceV2(threadId: string, family: FaceFamily = 'classic', options: {
  seed?: number; inheritedEyes?: string;
} = {}): GeneratedFace {
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
} = {}): string {
  const { state = 'idle', elapsed = 0, animation = false } = options;
  let eyes = identity.eyes;
  if (state === 'error') eyes = 'x';
  else if (state === 'waiting') eyes = '?';
  else if (state === 'running') eyes = animation && Math.floor(elapsed / 750) % 2 ? '>' : '<';
  return `${identity.ears[0]}${eyes}${identity.mouth}${eyes}${identity.ears[1]}${identity.accessory ?? ''}`;
}
