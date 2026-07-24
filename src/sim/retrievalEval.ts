import { DOCTRINE_CORPUS } from "./doctrine";
import { retrievalProvider, type RetrievalMode } from "./retrieval";
import type { SimState } from "./types";

// GR-9 (GR-D13): the retrieval evaluation harness.
//
// Supports the two arms the plan requires — `none` (no RAG) and `tfidf` — so
// the same question can be scored with and without retrieved policy. Model-A vs
// model-B comparison runs the SAME assembled context against two model ids, so
// the only variable is the model; that lives at the request layer (api/chat.ts
// already takes a model id), and this module supplies the retrieval half.
//
// Everything here is deterministic and offline: no model call, no embeddings.
// It measures whether the RIGHT POLICY reached the prompt, which is the part
// that can be judged without a human. Answer-level judgements (grounded
// correctness, hallucination rate) need generated text, so this module defines
// how they are scored and leaves the generation to the caller.

/** One labelled question: which doctrine sections SHOULD be retrieved. */
export type EvalCase = {
  id: string;
  question: string;
  /** Section ids a correct retrieval must surface. */
  relevantSectionIds: string[];
};

export type RetrievalMetrics = {
  caseId: string;
  mode: RetrievalMode;
  k: number;
  precisionAtK: number;
  recallAtK: number;
  hitRateAtK: number;
  /** Mean reciprocal rank of the first relevant section (0 when none found). */
  reciprocalRank: number;
  latencyMs: number;
  /** Characters of retrieved policy — the token cost retrieval adds. */
  contextChars: number;
  retrievedSectionIds: string[];
};

export type EvalSummary = {
  mode: RetrievalMode;
  k: number;
  cases: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  hitRateAtK: number;
  mrr: number;
  meanLatencyMs: number;
  meanContextChars: number;
};

/**
 * The labelled maritime set. Small and hand-checked on purpose: every expected
 * section is one a duty manager would actually need for that question, so a
 * regression here means retrieval genuinely got worse, not that a fixture drifted.
 */
export const MARITIME_EVAL_CASES: readonly EvalCase[] = [
  {
    id: "why-reroute",
    question: "Why is this vessel being rerouted instead of held?",
    relevantSectionIds: ["MAR-ROUTE §1"],
  },
  {
    id: "storm-on-route",
    question: "A storm is on the vessel's route — when do we avoid a segment entirely?",
    relevantSectionIds: ["MAR-ROUTE §2"],
  },
  {
    id: "congestion-wait",
    question: "How does congestion and expected port waiting time affect the route choice?",
    relevantSectionIds: ["MAR-ROUTE §3"],
  },
  {
    id: "strait-guidance",
    question: "Which strait does traffic use to reach Singapore, and what is the alternative?",
    relevantSectionIds: ["MAR-ROUTE §4"],
  },
  {
    id: "read-cost",
    question: "How do I read the route cost and the minutes saved on a candidate?",
    relevantSectionIds: ["MAR-ROUTE §5"],
  },
  {
    id: "same-destination",
    question: "Can a reroute send the vessel to a different destination port?",
    relevantSectionIds: ["MAR-ROUTE §6", "MAR-ROUTE §1"],
  },
  {
    id: "blocked-segment",
    question: "What happens to a blocked or restricted segment in routing?",
    relevantSectionIds: ["MAR-ROUTE §7"],
  },
  {
    id: "who-approves",
    question: "Who approves a route change and can the assistant execute it?",
    relevantSectionIds: ["MAR-ROUTE §8"],
  },
];

/** Evaluate one case against one retrieval arm. */
export function evaluateCase(
  state: SimState,
  testCase: EvalCase,
  mode: RetrievalMode,
  k = 5,
): RetrievalMetrics {
  const provider = retrievalProvider(mode);
  const started = performance.now();
  const retrieved = provider.retrieve(state, testCase.question);
  const latencyMs = performance.now() - started;

  const topK = retrieved.slice(0, k);
  const ids = topK.map((r) => r.section.sectionId);
  const relevant = new Set(testCase.relevantSectionIds);
  const hits = ids.filter((id) => relevant.has(id));

  const firstHit = ids.findIndex((id) => relevant.has(id));

  return {
    caseId: testCase.id,
    mode,
    k,
    precisionAtK: ids.length === 0 ? 0 : hits.length / ids.length,
    recallAtK: relevant.size === 0 ? 1 : hits.length / relevant.size,
    hitRateAtK: hits.length > 0 ? 1 : 0,
    reciprocalRank: firstHit === -1 ? 0 : 1 / (firstHit + 1),
    latencyMs,
    contextChars: topK.reduce((sum, r) => sum + r.section.body.length, 0),
    retrievedSectionIds: ids,
  };
}

/** Evaluate a whole set and summarise. */
export function evaluateSet(
  state: SimState,
  cases: readonly EvalCase[],
  mode: RetrievalMode,
  k = 5,
): { rows: RetrievalMetrics[]; summary: EvalSummary } {
  const rows = cases.map((c) => evaluateCase(state, c, mode, k));
  const mean = (pick: (r: RetrievalMetrics) => number) =>
    rows.length === 0 ? 0 : rows.reduce((s, r) => s + pick(r), 0) / rows.length;

  return {
    rows,
    summary: {
      mode,
      k,
      cases: rows.length,
      meanPrecisionAtK: mean((r) => r.precisionAtK),
      meanRecallAtK: mean((r) => r.recallAtK),
      hitRateAtK: mean((r) => r.hitRateAtK),
      mrr: mean((r) => r.reciprocalRank),
      meanLatencyMs: mean((r) => r.latencyMs),
      meanContextChars: mean((r) => r.contextChars),
    },
  };
}

// --- Answer-level scoring --------------------------------------------------
//
// These need generated text, so they are scored against what the deterministic
// services actually produced rather than against a reference answer. Each is
// automatable because the ground truth is a number the system already computed.

export type AnswerScore = {
  /** Every cited section id was actually supplied to the model. */
  citationAccuracy: number;
  /** Numbers in the answer that match no figure in the supplied context. */
  unsupportedFigures: string[];
  hallucinationRate: number;
  /** A proposed action passed the deterministic validator. */
  actionProposalValid: boolean | null;
};

/**
 * Score an answer for citation accuracy and unsupported figures.
 *
 * A citation is valid only if that section was in the prompt — citing a real
 * doctrine section that was never supplied is still a fabrication, because the
 * model did not read it.
 */
export function scoreAnswer(
  answer: string,
  suppliedSectionIds: readonly string[],
  contextText: string,
  actionProposalValid: boolean | null = null,
): AnswerScore {
  const cited = [...answer.matchAll(/\[([A-Z-]+ §\d+)\]/g)].map((m) => m[1]);
  const supplied = new Set(suppliedSectionIds);
  const validCitations = cited.filter((c) => supplied.has(c));

  // Figures the answer asserts that appear nowhere in what it was given. Bare
  // small integers are ignored — they are usually counts restated from prose.
  const figures = [...answer.matchAll(/\b\d[\d,]*\.?\d*\b/g)].map((m) => m[0]);
  const unsupportedFigures = figures.filter(
    (f) => Number(f.replace(/,/g, "")) > 10 && !contextText.includes(f) && !answer.includes(`[${f}]`),
  );

  return {
    citationAccuracy: cited.length === 0 ? 1 : validCitations.length / cited.length,
    unsupportedFigures,
    hallucinationRate: figures.length === 0 ? 0 : unsupportedFigures.length / figures.length,
    actionProposalValid,
  };
}

/** Every section id in the corpus — the universe a citation may name. */
export function corpusSectionIds(): string[] {
  return DOCTRINE_CORPUS.map((s) => s.sectionId);
}
