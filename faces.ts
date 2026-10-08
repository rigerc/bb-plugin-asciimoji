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

// Stable across processes and clients; never depends on a title or provider.
export function defaultFace(threadId: string, parentThreadId?: string | null): string {
  return renderFace(generateFace(threadId, parentThreadId));
}

export type FaceState = 'idle' | 'running' | 'waiting' | 'error';
export interface GeneratedFace {
  version: 1;
  ears: [string, string];
  eyes: string;
  mouth: string;
  blinkOffset: number;
}

function identityHash(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Thread identity is deterministic; children share their parent's hash-selected eyes. */
export function generateFace(threadId: string, parentThreadId?: string | null): GeneratedFace {
  const hash = identityHash(threadId);
  const eyeHash = identityHash(parentThreadId ?? threadId);
  const ears = [['(', ')'], ['ʕ', 'ʔ'], ['[', ']'], ['{', '}']] as const;
  const pair = ears[hash % ears.length]!;
  return {
    version: 1,
    ears: [pair[0], pair[1]],
    eyes: ['•', '^', 'o', '¬'][(eyeHash >>> 4) % 4]!,
    mouth: ['ω', 'ᴥ', 'ᴗ', '‿'][(hash >>> 8) % 4]!,
    blinkOffset: (hash >>> 12) % 4000,
  };
}

/** All expressions retain five glyphs; time is supplied by the caller. */
export function renderFace(identity: GeneratedFace, options: {
  state?: FaceState; elapsed?: number; animation?: boolean;
} = {}): string {
  const { state = 'idle', elapsed = 0, animation = false } = options;
  let eyes = identity.eyes;
  if (state === 'error') eyes = 'x';
  else if (state === 'waiting') eyes = '?';
  else if (state === 'running') eyes = animation && Math.floor(elapsed / 750) % 2 ? '>' : '<';
  else if (animation && (elapsed + identity.blinkOffset) % 6000 < 250) eyes = '-';
  return `${identity.ears[0]}${eyes}${identity.mouth}${eyes}${identity.ears[1]}`;
}
