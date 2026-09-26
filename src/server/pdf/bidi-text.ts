import bidiFactory from 'bidi-js'

const bidi = bidiFactory()

const MIRROR: Record<string, string> = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' }

export interface VisualRun {
  text: string
  rtl: boolean
}

/**
 * Split one line into directional runs in VISUAL (left-to-right drawing) order, following the
 * Unicode Bidirectional Algorithm (embedding levels + rule L2 on runs). RTL runs keep their
 * LOGICAL text (brackets mirrored): they are drawn with the font's right-to-left layout,
 * which shapes Arabic letters and reverses the glyphs. Numbers and Latin text inside Arabic
 * become their own LTR runs, so "284" never turns into "482".
 */
export function visualRuns(line: string, baseRtl: boolean): VisualRun[] {
  if (!line) return []
  const { levels } = bidi.getEmbeddingLevels(line, baseRtl ? 'rtl' : 'ltr')
  // Levels are per UTF-16 code unit, so index code units (surrogate pairs share a level).
  // Brackets inside right-to-left text are mirrored (UBA rule L4); the font layout does not.
  const chars = line.split('').map((c, i) => (levels[i]! % 2 === 1 ? (MIRROR[c] ?? c) : c))
  // Logical runs of equal level.
  const runs: { text: string; level: number }[] = []
  for (let i = 0; i < chars.length; i++) {
    const level = levels[i]!
    const last = runs[runs.length - 1]
    if (last && last.level === level) last.text += chars[i]
    else runs.push({ text: chars[i]!, level })
  }
  // L2: from the highest level down to the lowest odd level, reverse contiguous runs at or above it.
  const max = Math.max(...runs.map((r) => r.level))
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), max + 1)
  for (let lvl = max; lvl >= minOdd; lvl--) {
    for (let i = 0; i < runs.length; ) {
      if (runs[i]!.level >= lvl) {
        let j = i
        while (j < runs.length && runs[j]!.level >= lvl) j++
        runs.splice(i, j - i, ...runs.slice(i, j).reverse())
        i = j
      } else i++
    }
  }
  // Isolate marks (LRI/RLI/FSI/PDI) steer the ordering above but have no glyph: drop them.
  return runs.map((r) => ({ text: r.text.replace(/[\u2066-\u2069]/g, ''), rtl: r.level % 2 === 1 })).filter((r) => r.text.length > 0)
}

/** Keep a phone number, link or code in left-to-right order inside Arabic text (LRI … PDI). */
export function ltr(text: string): string {
  return `\u2066${text}\u2069`
}
