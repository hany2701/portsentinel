import { DOCTRINE_CORPUS, type DoctrineSection } from "./doctrine";

// D-66: field-weighted TF-IDF over the doctrine corpus. Pure and deterministic,
// built once at module init; imports nothing but the corpus so the api/ chat
// handler can reuse it server-side (D-67). No embeddings, no external calls.

const FIELD_WEIGHTS = { keywords: 3, title: 2, body: 1 } as const;

const normalize = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

// Function words + question scaffolding: at a 10-section corpus they scatter
// widely enough to outrank real terms on term frequency alone, so they are
// excluded outright rather than trusted to the df cutoff below.
const STOPWORDS = new Set(
  ("a an and or of to in on at by for from with about into over under the this that these those " +
    "there here is are was were be been do does did can could would should will must may " +
    "what when where which who why how i we you it they my our your their if then than but " +
    "not no any some only still also happen happens").split(" ").map(normalize),
);

// Lowercase, split on non-alphanumerics (§ kept so section refs survive), drop
// stopwords, and strip a trailing plural-s from longer tokens so "gusts"
// matches "gust". Applied identically to corpus and query.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9§]+/)
    .filter(Boolean)
    .map(normalize)
    .filter((t) => !STOPWORDS.has(t));
}

type IndexedSection = { section: DoctrineSection; tf: Map<string, number> };

let N = 0;
let INDEX: IndexedSection[] = [];
let IDF = new Map<string, number>();

// REAL-6 (D-84): DOCTRINE_CORPUS is rebuilt whenever calibration mode switches
// (its interpolated numbers change) — the index built over it must be rebuilt
// too, or a search would rank/return stale-text sections. Exported so
// sim/calibration.ts can call it right after the corpus changes; still called
// once below at module init, exactly as before REAL-6.
export function rebuildSearchIndex(): void {
  N = DOCTRINE_CORPUS.length;
  INDEX = DOCTRINE_CORPUS.map((section) => {
    const tf = new Map<string, number>();
    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) tf.set(t, (tf.get(t) ?? 0) + weight);
    };
    add(section.keywords.join(" "), FIELD_WEIGHTS.keywords);
    add(`${section.sectionId} ${section.title}`, FIELD_WEIGHTS.title);
    add(section.body, FIELD_WEIGHTS.body);
    return { section, tf };
  });

  // idf = ln(1 + N/df). Terms present in more than half the sections carry no
  // signal at this corpus size and are dropped — a stopword rule with no list.
  const df = new Map<string, number>();
  for (const { tf } of INDEX) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  IDF = new Map<string, number>();
  for (const [t, d] of df) if (d <= N / 2) IDF.set(t, Math.log(1 + N / d));
}
rebuildSearchIndex();

export type DoctrineHit = { section: DoctrineSection; score: number };

/** Rank corpus sections against a free-text query; only positive scores return. */
export function searchDoctrine(query: string, k = 3): DoctrineHit[] {
  const terms = [...new Set(tokenize(query))];
  return INDEX.map(({ section, tf }) => ({
    section,
    score: terms.reduce((sum, t) => sum + (tf.get(t) ?? 0) * (IDF.get(t) ?? 0), 0),
  }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.section.sectionId.localeCompare(b.section.sectionId))
    .slice(0, k);
}
