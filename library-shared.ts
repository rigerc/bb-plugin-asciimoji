import type { LibraryEntry } from './library.js';

/** Kind-aware keys are shared with the browser review UI; no server imports at runtime. */
export const libraryEntryKey = (entry: LibraryEntry): string => entry.kind === 'generated'
  ? `generated:${entry.snapshotId}` : `text:${JSON.stringify([entry.face, entry.expressions?.running ?? null, entry.expressions?.waiting ?? null, entry.expressions?.error ?? null])}`;
