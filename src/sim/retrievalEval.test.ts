import { describe, expect, it } from "vitest";
import { generateWorld, tick } from ".";
import { DOCTRINE_CORPUS } from "./doctrine";
import { retrieveDoctrineScored, retrievalProvider } from "./retrieval";
import {
  MARITIME_EVAL_CASES,
  corpusSectionIds,
  evaluateSet,
  scoreAnswer,
} from "./retrievalEval";
import { buildSystemPrompt } from "../utils/contextBuilder";
import { searchDoctrine } from "./searchIndex";

// GR-9 (GR-D13): deterministic TF-IDF lexical RAG with structured runtime
// grounding. These tests pin the three things that make that claim honest:
// the policy is retrievable, the fast-changing figures are injected rather than
// retrieved, and the evaluation arms actually differ.

const SEED = 20260710;

describe("maritime doctrine corpus (GR-9)", () => {
  it("adds the eight approved MAR-ROUTE sections", () => {
    const sections = DOCTRINE_CORPUS.filter((s) => s.docId === "MAR-ROUTE");
    expect(sections).toHaveLength(8);
    expect(sections.map((s) => s.sectionId)).toEqual([
      "MAR-ROUTE §1",
      "MAR-ROUTE §2",
      "MAR-ROUTE §3",
      "MAR-ROUTE §4",
      "MAR-ROUTE §5",
      "MAR-ROUTE §6",
      "MAR-ROUTE §7",
      "MAR-ROUTE §8",
    ]);
    for (const s of sections) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.keywords.length).toBeGreaterThan(2);
      expect(s.body.length).toBeGreaterThan(100);
    }
  });

  it("covers every policy area the plan requires", () => {
    const byId = new Map(DOCTRINE_CORPUS.map((s) => [s.sectionId, s]));
    const requires: Array<[string, RegExp]> = [
      ["MAR-ROUTE §1", /hold/i],
      ["MAR-ROUTE §2", /weather/i],
      ["MAR-ROUTE §3", /congestion/i],
      ["MAR-ROUTE §4", /strait|corridor/i],
      ["MAR-ROUTE §5", /cost/i],
      ["MAR-ROUTE §6", /destination/i],
      ["MAR-ROUTE §7", /restrict|blocked/i],
      ["MAR-ROUTE §8", /approv/i],
    ];
    for (const [id, pattern] of requires) {
      expect(byId.get(id)!.body).toMatch(pattern);
    }
  });

  it("quotes the live routing thresholds rather than hardcoding prose", () => {
    // The corpus is rebuilt from doctrine values, so a threshold change can
    // never leave the retrieved text asserting a number the engine no longer uses.
    const s2 = DOCTRINE_CORPUS.find((s) => s.sectionId === "MAR-ROUTE §2")!;
    expect(s2.body).toContain("80"); // blockWeatherRiskAtOrAbove
    expect(s2.body).toContain("70"); // rerouteWeatherThreshold
    expect(s2.body).toContain("55"); // highRiskWeatherThreshold
  });

  it("keeps fast-changing operational values OUT of retrieved policy", () => {
    // Positions, ETAs and candidate costs belong in structured runtime context;
    // a doctrine section quoting them would be stale within a tick.
    for (const s of DOCTRINE_CORPUS.filter((x) => x.docId === "MAR-ROUTE")) {
      expect(s.body).not.toMatch(/\bV-\d+\b/); // no vessel ids
      expect(s.body).not.toMatch(/\bRP-\d+\b/); // no route plan ids
      expect(s.body).not.toMatch(/\d+\.\d+°/); // no coordinates
    }
  });
});

describe("retrieval of maritime policy (GR-9)", () => {
  it("finds the right section for a routing question", () => {
    const hits = searchDoctrine("why reroute instead of hold the vessel", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.section.docId === "MAR-ROUTE")).toBe(true);
  });

  it("force-includes routing policy while a reroute advisory is pending", () => {
    const state = generateWorld(SEED);
    // Nothing pending → routing policy is not forced in.
    const quiet = retrieveDoctrineScored(state, "berth utilisation");
    expect(quiet.filter((r) => r.forced).some((r) => r.section.docId === "MAR-ROUTE")).toBe(false);

    state.maritime.rerouteDecisions.push({
      id: "RD-TEST",
      vesselId: "V-1",
      originalPlanId: "RP-1",
      reason: "weather",
      highRiskEdgeIds: [],
      delayAvoidedMinutes: 30,
      additionalDistanceNm: 10,
      approvalStatus: "pending",
      createdTick: state.clock.tick,
    });

    // Pending advisory → policy arrives even on an unrelated question, the same
    // state-follows-doctrine boost the disruption docs use.
    const forced = retrieveDoctrineScored(state, "berth utilisation");
    expect(forced.filter((r) => r.forced).some((r) => r.section.docId === "MAR-ROUTE")).toBe(true);
  });

  it("preserves the existing retrieval architecture", () => {
    const state = generateWorld(SEED);
    const result = retrieveDoctrineScored(state, "crane wind limits");
    // Forced sections first, then ranked; top-K limit on the ranked tail.
    const rankedCount = result.filter((r) => !r.forced).length;
    expect(rankedCount).toBeLessThanOrEqual(3);
    // Deduplicated: a section never appears twice.
    const ids = result.map((r) => r.section.sectionId);
    expect(new Set(ids).size).toBe(ids.length);
    // Metadata for the citation trace survives.
    for (const r of result) {
      expect(typeof r.score).toBe("number");
      expect(typeof r.forced).toBe("boolean");
    }
  });

  it("is deterministic", () => {
    const state = generateWorld(SEED);
    const a = retrieveDoctrineScored(state, "how is route cost calculated");
    const b = retrieveDoctrineScored(state, "how is route cost calculated");
    expect(b.map((r) => r.section.sectionId)).toEqual(a.map((r) => r.section.sectionId));
  });
});

describe("structured runtime grounding (GR-9)", () => {
  it("injects maritime state into the prompt with provenance", () => {
    const state = generateWorld(SEED);
    const prompt = buildSystemPrompt(state, "what is happening at sea?");
    expect(prompt).toContain("Maritime network [simulated positions, calculated routes]");
    expect(prompt).toContain("Reroute advisories [calculated]");
  });

  it("states the authoritative counts, so the model never invents them", () => {
    const state = generateWorld(SEED);
    const prompt = buildSystemPrompt(state, "how many vessels are tracked?");
    expect(prompt).toContain("108 tracked vessels");
    expect(prompt).toContain("22-vessel");
  });

  it("says 'none' rather than omitting the line when nothing is pending", () => {
    const state = generateWorld(SEED);
    expect(buildSystemPrompt(state, "any reroutes?")).toContain("Reroute advisories [calculated]: none.");
  });

  it("carries route-candidate figures once an advisory exists", () => {
    let state = generateWorld(SEED);
    for (let i = 0; i < 4000 && state.maritime.rerouteDecisions.length === 0; i++) state = tick(state);
    if (state.maritime.rerouteDecisions.length === 0) return; // calm run; covered above
    const prompt = buildSystemPrompt(state, "why is that vessel rerouting?");
    expect(prompt).toMatch(/reason (weather|congestion|safety|combined)/);
    expect(prompt).toMatch(/saves -?\d+ min/);
  });

  it("keeps route geometry out of the prompt", () => {
    // The AI boundary (plan §5C.5): IDs and computed facts, never polygon or
    // coordinate arrays — those would crowd out state and invite geometric
    // reasoning the model should not attempt.
    const state = generateWorld(SEED);
    const prompt = buildSystemPrompt(state, "show me the routes");
    expect(prompt).not.toMatch(/\[\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*\]/);
  });
});

describe("evaluation harness (GR-9)", () => {
  it("scores the labelled maritime set under TF-IDF", () => {
    const state = generateWorld(SEED);
    const { rows, summary } = evaluateSet(state, MARITIME_EVAL_CASES, "tfidf");
    expect(rows).toHaveLength(MARITIME_EVAL_CASES.length);
    expect(summary.mode).toBe("tfidf");
    // Retrieval must actually work on its own doctrine — a floor, not a fit.
    expect(summary.hitRateAtK).toBeGreaterThan(0.5);
    expect(summary.mrr).toBeGreaterThan(0.3);
    for (const r of rows) {
      expect(r.precisionAtK).toBeGreaterThanOrEqual(0);
      expect(r.precisionAtK).toBeLessThanOrEqual(1);
      expect(r.recallAtK).toBeLessThanOrEqual(1);
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("distinguishes the no-RAG arm", () => {
    const state = generateWorld(SEED);
    const withRag = evaluateSet(state, MARITIME_EVAL_CASES, "tfidf").summary;
    const without = evaluateSet(state, MARITIME_EVAL_CASES, "none").summary;
    // The control arm retrieves nothing, so it scores zero and costs no context.
    expect(without.hitRateAtK).toBe(0);
    expect(without.meanContextChars).toBe(0);
    expect(withRag.hitRateAtK).toBeGreaterThan(without.hitRateAtK);
    expect(withRag.meanContextChars).toBeGreaterThan(0);
  });

  it("runs deterministically, so a regression is a real change", () => {
    const state = generateWorld(SEED);
    const a = evaluateSet(state, MARITIME_EVAL_CASES, "tfidf").rows.map((r) => r.retrievedSectionIds);
    const b = evaluateSet(state, MARITIME_EVAL_CASES, "tfidf").rows.map((r) => r.retrievedSectionIds);
    expect(b).toEqual(a);
  });

  it("provides both retrieval arms through one provider seam", () => {
    const state = generateWorld(SEED);
    expect(retrievalProvider("tfidf").id).toBe("tfidf");
    expect(retrievalProvider("none").id).toBe("none");
    expect(retrievalProvider("none").retrieve(state, "anything")).toEqual([]);
    expect(retrievalProvider("tfidf").retrieve(state, "reroute policy").length).toBeGreaterThan(0);
  });

  it("scores citations against what was actually supplied", () => {
    const supplied = ["MAR-ROUTE §1", "OPS-WX §1"];
    const context = "Best alternative saves 45 min, total cost 320 min.";

    const good = scoreAnswer("Hold is preferred here [MAR-ROUTE §1]. It saves 45 min.", supplied, context);
    expect(good.citationAccuracy).toBe(1);
    expect(good.unsupportedFigures).toEqual([]);

    // Citing a real section that was never supplied is still a fabrication.
    const badCite = scoreAnswer("See [MAR-ROUTE §5].", supplied, context);
    expect(badCite.citationAccuracy).toBe(0);

    // A figure that appears nowhere in the context is flagged.
    const invented = scoreAnswer("This saves 999 min [MAR-ROUTE §1].", supplied, context);
    expect(invented.unsupportedFigures).toContain("999");
    expect(invented.hallucinationRate).toBeGreaterThan(0);
  });

  it("only names sections that exist in the corpus", () => {
    const known = new Set(corpusSectionIds());
    for (const c of MARITIME_EVAL_CASES) {
      for (const id of c.relevantSectionIds) {
        expect(known.has(id), `eval case ${c.id} expects missing section ${id}`).toBe(true);
      }
    }
  });
});
