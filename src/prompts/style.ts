// D-120 output style contract (supersedes D-65's plain-text rule), refined by
// D-122 (compact per-entity list rows + no em/en dashes).
//
// D-65 mandated plain text for one reason: "the chat drawer renders raw text (no
// markdown renderer)". That is no longer true: `components/chat/ResponseBody.tsx`
// renders a structured schema, so the constraint that forced status flags, metrics
// and context into one dense paragraph is gone.
//
// The schema is line-prefixed, not markdown: it keeps the model inside a small,
// renderable vocabulary (no runaway headings or wide tables in a 26rem drawer) and
// it degrades safely (any unprefixed line renders as ordinary prose). Brevity still
// must never cost substance: provenance, citations, and the full D-56 safety-stock
// advisory fields always survive.
//
// The instruction text below is itself written without em/en dashes, so it models
// the output the model is asked to produce.
export const OUTPUT_STYLE = [
  "Structure every reply with these line prefixes. Each must start its own line.",
  "  STATUS: <one-line verdict>. The headline answer; use at most one, first.",
  "  METRIC: <label> | <value>. One per line for the figures of the CURRENT single subject (keep the provenance label in the value, e.g. \"100 / critical [simulated]\").",
  "  SECTION: <title>. A short heading before a group of points or a list.",
  "  POINT: <text>. One item of a list.",
  "Anything without a prefix is ordinary prose. Use prose for reasoning and trade-offs; use METRIC lines for figures. Never bury figures inside a paragraph.",
  "Listing several items that share the same fields (one per customer, vessel or berth): give EACH item ONE compact POINT line, the name in **bold** then its key figures separated by middle dots ' · ', e.g. \"POINT: **ChillChain Logistics** 5101 TEU · cover 3.7d · delay 0.5d · shortfall 1d · not raised\". Do NOT stack a SECTION plus several METRIC lines per item, and never separate fields with a pipe '|' inside a POINT. Put the list's shared provenance and citation on the SECTION heading above it.",
  "Never use em dashes or en dashes (the — or – characters) anywhere in a reply. Use a comma, a colon, or a new sentence instead. A plain hyphen inside a compound word or a numeric range (well-known, 80-90%) is fine.",
  "Use **bold** for the decisive words only: a verdict, an entity id, or the name that leads a list row. Never use markdown headings (the # character) or tables drawn with dashes or pipes; the prefixes above replace them.",
  "Default to brief: at most ~120 words of prose or 6 items. Go longer only when the duty manager explicitly asks for detail.",
  "Being brief never drops substance: quoted values keep their provenance labels, doctrine citations stay inline as [OPS-X §n], and a safety-stock advisory still names every field for each customer (affected TEU, days of cover, expected delay, computed shortfall, pending status) in the compact one-line-per-customer form above.",
].map((c) => `- ${c}`).join("\n");
