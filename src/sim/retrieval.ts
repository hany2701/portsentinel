import { DOCTRINE, DOCTRINE_CORPUS, type DoctrineSection } from "./doctrine";
import { searchDoctrine } from "./searchIndex";
import { yardUtilisationPct } from "./derive";
import type { SimState } from "./types";

// Which doctrine doc a given active disruption pulls into context (D-33).
const DISRUPTION_DOCS: Partial<Record<SimState["disruptions"][number]["type"], string>> = {
  storm: "OPS-WX",
  craneFailure: "OPS-CRANE",
  berthClosure: "OPS-BERTH",
  arrivalSurge: "OPS-BERTH",
};

export type RetrievedSection = { section: DoctrineSection; score: number; forced: boolean };

/**
 * GR-9 (GR-D13): which retrieval arm to use.
 *
 * `tfidf` is the shipped behaviour. `none` exists so the same question can be
 * answered with and without retrieved policy, which is the comparison the
 * evaluation harness measures. There is deliberately no `embeddings` arm in the
 * first release — see RetrievalProvider.
 */
export type RetrievalMode = "none" | "tfidf";

/**
 * The seam a future semantic or hybrid retriever plugs into.
 *
 * The chatbot, context builder and response-validation pipeline all consume
 * this shape rather than calling the TF-IDF index directly, so adding
 * embeddings later means adding a provider — not rewriting any of them. The
 * first release ships exactly one implementation: no embeddings, no vector
 * store, no semantic reranking (GR-D13).
 */
export type RetrievalProvider = {
  id: RetrievalMode;
  /** Ranked policy sections for a question, given current operational state. */
  retrieve(state: SimState, userMessage: string): RetrievedSection[];
};

export const TFIDF_PROVIDER: RetrievalProvider = {
  id: "tfidf",
  retrieve: (state, userMessage) => retrieveDoctrineScored(state, userMessage, "tfidf"),
};

/** The control arm: structured runtime context only, no retrieved policy. */
export const NO_RAG_PROVIDER: RetrievalProvider = {
  id: "none",
  retrieve: () => [],
};

export function retrievalProvider(mode: RetrievalMode): RetrievalProvider {
  return mode === "none" ? NO_RAG_PROVIDER : TFIDF_PROVIDER;
}

/**
 * Lightweight topic retrieval (D-33, scoring amended by D-66): rank corpus sections by
 * field-weighted TF-IDF against the user message, and force in whole docs implicated by
 * the current situation (active disruptions, elevated weather/yard). Returns the forced
 * sections plus the top 3 scored sections, with score + forced metadata for the response
 * trace (D-68). No embeddings — the boosts make doctrine follow the state.
 */
export function retrieveDoctrineScored(
  state: SimState,
  userMessage: string,
  mode: RetrievalMode = "tfidf",
): RetrievedSection[] {
  // GR-9: the "no RAG" evaluation arm. The assistant still receives its
  // structured runtime context — only retrieved policy is withheld, which is
  // exactly the variable a with/without-RAG comparison is meant to isolate.
  if (mode === "none") return [];

  const forcedDocs = new Set<string>();
  for (const d of state.disruptions) {
    const active = state.clock.tick >= d.startTick && state.clock.tick < d.startTick + d.durationTicks;
    const doc = DISRUPTION_DOCS[d.type];
    if (active && doc) forcedDocs.add(doc);
  }
  if (state.weather.riskIndex > DOCTRINE.weather.cautionMax) forcedDocs.add("OPS-WX");
  if (yardUtilisationPct(state) >= DOCTRINE.yard.elevatedBelowPct) forcedDocs.add("OPS-YARD");
  // INT-7: active weather-ops suspensions pull in the docs that explain them,
  // so the assistant can ground "why is that crane stopped / vessel held".
  if (state.wxOps.stsSuspended || state.wxOps.rtgSuspended) forcedDocs.add("OPS-CRANE");
  if (state.wxOps.movesSuspended) forcedDocs.add("OPS-WX");
  // GR-9: a live reroute decision pulls in the routing policy, so "why is this
  // vessel being rerouted" is always answered against doctrine rather than
  // improvised — the same state-follows-doctrine boost the disruptions use.
  if (state.maritime.rerouteDecisions.some((d) => d.approvalStatus === "pending")) {
    forcedDocs.add("MAR-ROUTE");
  }

  const forced = DOCTRINE_CORPUS
    .filter((s) => forcedDocs.has(s.docId))
    .map((section) => ({ section, score: 0, forced: true }));
  const ranked = searchDoctrine(userMessage, DOCTRINE_CORPUS.length)
    .filter((h) => !forcedDocs.has(h.section.docId))
    .slice(0, 3)
    .map((h) => ({ section: h.section, score: h.score, forced: false }));

  return [...forced, ...ranked];
}

export function retrieveDoctrine(state: SimState, userMessage: string): DoctrineSection[] {
  return retrieveDoctrineScored(state, userMessage).map((r) => r.section);
}

// Always-on one-line index of every doc title (D-33) — the agent sees the full menu
// even when a section wasn't retrieved.
export function doctrineIndex(): string {
  return DOCTRINE_CORPUS.map((s) => `${s.sectionId} ${s.title}`).join(" · ");
}
