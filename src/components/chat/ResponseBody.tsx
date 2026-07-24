import { Fragment, type ReactNode } from "react";
import { parseResponseBlocks, stripDashes, type MetricRow } from "./responseBlocks";

// Doctrine references render as chips whether bracketed or bare.
const CITATION = /(\[?OPS-[A-Z]+ §\d+\]?)/g;
// Only matches a CLOSED pair, so a half-streamed "**Berthing" stays literal text
// instead of swallowing the rest of the reply.
const BOLD = /(\*\*[^*]+\*\*)/g;

function withCitations(text: string, keyPrefix: string): ReactNode[] {
  return text.split(CITATION).map((part, i) =>
    /^\[?OPS-[A-Z]+ §\d+\]?$/.test(part) ? (
      <span
        key={`${keyPrefix}-c${i}`}
        className="mx-0.5 whitespace-nowrap rounded bg-[#2a78d6]/10 px-1 py-0.5 text-xs font-medium text-[#2a78d6] dark:text-[#3987e5]"
      >
        {part.replace(/[[\]]/g, "")}
      </span>
    ) : (
      <Fragment key={`${keyPrefix}-t${i}`}>{part}</Fragment>
    ),
  );
}

/** Inline formatting: **bold** plus doctrine citation chips. */
export function inline(text: string, keyPrefix = "i"): ReactNode[] {
  return text.split(BOLD).flatMap((part, i): ReactNode[] =>
    /^\*\*[^*]+\*\*$/.test(part)
      ? [
          <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-slate-900 dark:text-white">
            {withCitations(part.slice(2, -2), `${keyPrefix}-b${i}`)}
          </strong>,
        ]
      : withCitations(part, `${keyPrefix}-${i}`),
  );
}

function StatusBlock({ text }: { text: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border-l-2 border-[#2a78d6] bg-[#2a78d6]/5 py-1.5 pl-2 pr-2 first:mt-0 dark:bg-[#2a78d6]/10">
      <p className="text-sm font-semibold leading-snug text-slate-900 dark:text-white">{inline(text, "st")}</p>
    </div>
  );
}

function MetricsBlock({ rows }: { rows: MetricRow[] }) {
  return (
    <dl className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      {rows.map((row, i) => (
        <div key={`m${i}`} className="flex items-baseline justify-between gap-3 px-2 py-1">
          <dt className="text-xs text-slate-500 dark:text-slate-400">{inline(row.label, `ml${i}`)}</dt>
          <dd className="text-right text-xs font-medium tabular-nums text-slate-900 dark:text-slate-100">
            {inline(row.value, `mv${i}`)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Renders the assistant's reply as structured blocks (D-120). Unrecognized lines
 * fall through to prose, so a model that ignores the schema still reads exactly
 * as it did before.
 */
export function ResponseBody({ content }: { content: string }) {
  const blocks = parseResponseBlocks(stripDashes(content));

  return (
    <div className="text-sm leading-relaxed text-slate-800 dark:text-slate-100">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "status":
            return <StatusBlock key={i} text={block.text} />;
          case "metrics":
            return <MetricsBlock key={i} rows={block.rows} />;
          case "section":
            return (
              <p
                key={i}
                className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400 first:mt-0 dark:text-slate-500"
              >
                {block.text}
              </p>
            );
          case "points":
            return (
              <ul key={i} className="mt-1.5 space-y-1">
                {block.items.map((item, j) => (
                  <li key={j} className="flex gap-1.5">
                    <span aria-hidden="true" className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-slate-400 dark:bg-slate-600" />
                    <span className="min-w-0 break-words">{inline(item, `p${i}-${j}`)}</span>
                  </li>
                ))}
              </ul>
            );
          default:
            return (
              <p key={i} className="mt-2 whitespace-pre-wrap break-words first:mt-0">
                {inline(block.text, `pr${i}`)}
              </p>
            );
        }
      })}
    </div>
  );
}
