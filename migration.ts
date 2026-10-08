import type { FaceFamily, GeneratedFace } from './faces.js';

// Read-once storage migration only. This frozen v1 recipe is not used for
// automatic generation or new choices; it produces a v2 snapshot with identical
// glyphs, including the original five-codepoint width (no accessory).
const legacyParts = {
  bear: { ears: ['ʕ', 'ʔ'], eyes: ['•', '^', 'o', '˘'], mouths: ['ᴥ', 'ω'] },
  robot: { ears: ['[', ']'], eyes: ['o', '•', '°', '¬'], mouths: ['_', '−', '='] },
  cat: { ears: ['(', ')'], eyes: ['^', '˘', '•', '='], mouths: ['ω'] },
  minimal: { ears: ['(', ')'], eyes: ['•', '･', '˘', '·'], mouths: ['_', '‿', 'ᴗ'] },
} as const;

function oldHash(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

/** Freeze a stored v1 recipe as a v2 identity without changing its appearance. */
export function migrateGeneratedV1(
  threadId: string, parentThreadId: string | null | undefined, family: FaceFamily = 'classic',
): GeneratedFace {
  const hash = oldHash(threadId);
  const eyeHash = oldHash(parentThreadId ?? threadId);
  const ears = [['(', ')'], ['ʕ', 'ʔ'], ['[', ']'], ['{', '}']] as const;
  const parts = family === 'classic' ? undefined : legacyParts[family];
  const pair = parts?.ears ?? ears[hash % ears.length]!;
  const eyes = parts?.eyes ?? ['•', '^', 'o', '¬'];
  const mouths = parts?.mouths ?? ['ω', 'ᴥ', 'ᴗ', '‿'];
  return {
    version: 2,
    family,
    ears: [pair[0], pair[1]],
    eyes: eyes[(eyeHash >>> 4) % eyes.length]!,
    mouth: mouths[(hash >>> 8) % mouths.length]!,
    blinkOffset: (hash >>> 12) % 4000,
  };
}
