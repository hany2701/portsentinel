import { describe, expect, it } from "vitest";
import { parseResponseBlocks, stripDashes } from "./responseBlocks";

describe("parseResponseBlocks (D-120)", () => {
  it("parses the four prefixes into typed blocks", () => {
    const blocks = parseResponseBlocks(
      [
        "STATUS: Berthing suspended",
        "METRIC: Weather risk | 100 / critical [simulated]",
        "METRIC: Gusts | 61.9 kt",
        "SECTION: Priorities",
        "POINT: Reroute the corridor vessels",
        "POINT: Hold the anchored vessels",
        "Rationale prose here.",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "status", text: "Berthing suspended" },
      {
        kind: "metrics",
        rows: [
          { label: "Weather risk", value: "100 / critical [simulated]" },
          { label: "Gusts", value: "61.9 kt" },
        ],
      },
      { kind: "section", text: "Priorities" },
      { kind: "points", items: ["Reroute the corridor vessels", "Hold the anchored vessels"] },
      { kind: "prose", text: "Rationale prose here." },
    ]);
  });

  it("groups only CONSECUTIVE metrics, so a section splits them", () => {
    const blocks = parseResponseBlocks("METRIC: A | 1\nSECTION: X\nMETRIC: B | 2");
    expect(blocks.map((b) => b.kind)).toEqual(["metrics", "section", "metrics"]);
  });

  // Drift tolerance: the whole point of the line-prefix design.
  it("renders an unprefixed reply entirely as prose (model ignores the schema)", () => {
    const text = "Cranes are stopped because the weather is in the critical band [OPS-WX §1].";
    expect(parseResponseBlocks(text)).toEqual([{ kind: "prose", text }]);
  });

  it("keeps a blank line as a paragraph break", () => {
    const blocks = parseResponseBlocks("First para.\n\nSecond para.");
    expect(blocks).toEqual([
      { kind: "prose", text: "First para." },
      { kind: "prose", text: "Second para." },
    ]);
  });

  // Streaming: every prefix of the final text must parse without throwing, and a
  // half-arrived METRIC keeps its label while the value fills in.
  it("parses every intermediate streaming state safely", () => {
    const full = "STATUS: Berthing suspended\nMETRIC: Gusts | 61.9 kt\nPOINT: Hold V-175";
    for (let i = 1; i <= full.length; i++) {
      expect(() => parseResponseBlocks(full.slice(0, i))).not.toThrow();
    }
    const midMetric = parseResponseBlocks("STATUS: X\nMETRIC: Gusts");
    expect(midMetric[1]).toEqual({ kind: "metrics", rows: [{ label: "Gusts", value: "" }] });
  });

  it("treats ordinary hyphen bullets as points (graceful partial drift)", () => {
    const blocks = parseResponseBlocks("- first\n- second");
    expect(blocks).toEqual([{ kind: "points", items: ["first", "second"] }]);
  });

  it("is case-insensitive on prefixes and ignores empty input", () => {
    expect(parseResponseBlocks("status: ok")).toEqual([{ kind: "status", text: "ok" }]);
    expect(parseResponseBlocks("   \n\n  ")).toEqual([]);
  });
});

describe("stripDashes (D-122)", () => {
  it("replaces a spaced em dash with a comma", () => {
    expect(stripDashes("Yes — all four customers show a shortfall")).toBe("Yes, all four customers show a shortfall");
  });

  it("replaces an unspaced em dash with a comma too", () => {
    expect(stripDashes("risk 100—critical band")).toBe("risk 100, critical band");
  });

  it("turns an en dash into a hyphen (ranges/compounds keep reading right)", () => {
    expect(stripDashes("gusts 80–90 kt on the Rotterdam–Tuas leg")).toBe("gusts 80-90 kt on the Rotterdam-Tuas leg");
  });

  it("leaves plain hyphens and middle dots untouched", () => {
    expect(stripDashes("**ChillChain** 5101 TEU · cover 3.7d · well-known")).toBe("**ChillChain** 5101 TEU · cover 3.7d · well-known");
  });

  it("keeps line prefixes intact after stripping", () => {
    expect(stripDashes("METRIC: Wind | 43 kt — gusting 62")).toBe("METRIC: Wind | 43 kt, gusting 62");
  });
});
