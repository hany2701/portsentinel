/**
 * D-120: parses the assistant's line-prefixed response schema into typed blocks
 * for structured rendering. Supersedes D-65's plain-text rule (its rationale was
 * "the chat UI has no markdown renderer" — this is that renderer).
 *
 * Line-prefixed rather than JSON for two reasons that matter here:
 *  - STREAMING: content arrives token by token, so each COMPLETE line renders as
 *    soon as it lands and a half-arrived trailing line degrades to prose rather
 *    than breaking a parse.
 *  - DRIFT TOLERANCE: any line without a known prefix is prose, so if the model
 *    ignores the schema entirely the reply still renders exactly as it used to.
 *    The renderer can never "fail" — worst case it looks like the old output.
 */

export type MetricRow = { label: string; value: string };

/**
 * D-122: the chat must never render em or en dashes (owner style rule). The prompt
 * asks the model to avoid them, but models emit em dashes anyway, so this is the
 * deterministic guarantee applied before parsing. A spaced or unspaced em dash
 * becomes a comma; an en dash (usually a range or a compound) becomes a hyphen.
 */
export function stripDashes(s: string): string {
  return s.replace(/\s*—\s*/g, ", ").replace(/\s*–\s*/g, "-");
}

export type Block =
  | { kind: "status"; text: string }
  | { kind: "metrics"; rows: MetricRow[] }
  | { kind: "section"; text: string }
  | { kind: "points"; items: string[] }
  | { kind: "prose"; text: string };

const STATUS = /^STATUS:\s*/i;
const METRIC = /^METRIC:\s*/i;
const SECTION = /^SECTION:\s*/i;
const POINT = /^POINT:\s*/i;
// The model may also fall back to ordinary hyphen bullets; treat them as points
// so a partial drift still reads as a list rather than run-on prose.
const BULLET = /^[-•]\s+/;

export function parseResponseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let metrics: MetricRow[] = [];
  let points: string[] = [];
  let prose: string[] = [];

  const flushMetrics = () => {
    if (metrics.length) blocks.push({ kind: "metrics", rows: metrics });
    metrics = [];
  };
  const flushPoints = () => {
    if (points.length) blocks.push({ kind: "points", items: points });
    points = [];
  };
  const flushProse = () => {
    const text = prose.join("\n").trim();
    if (text) blocks.push({ kind: "prose", text });
    prose = [];
  };
  const flushAll = () => {
    flushMetrics();
    flushPoints();
    flushProse();
  };

  for (const raw of content.split("\n")) {
    const line = raw.trim();

    if (!line) {
      flushAll();
      continue;
    }

    if (STATUS.test(line)) {
      flushAll();
      blocks.push({ kind: "status", text: line.replace(STATUS, "").trim() });
      continue;
    }

    if (SECTION.test(line)) {
      flushAll();
      blocks.push({ kind: "section", text: line.replace(SECTION, "").trim() });
      continue;
    }

    if (METRIC.test(line)) {
      flushPoints();
      flushProse();
      const body = line.replace(METRIC, "");
      const pipe = body.indexOf("|");
      // No pipe yet == still streaming that line; keep the label and let the
      // value fill in on the next frame.
      metrics.push(
        pipe === -1
          ? { label: body.trim(), value: "" }
          : { label: body.slice(0, pipe).trim(), value: body.slice(pipe + 1).trim() },
      );
      continue;
    }

    if (POINT.test(line) || BULLET.test(line)) {
      flushMetrics();
      flushProse();
      points.push(line.replace(POINT, "").replace(BULLET, "").trim());
      continue;
    }

    flushMetrics();
    flushPoints();
    prose.push(line);
  }

  flushAll();
  return blocks;
}
