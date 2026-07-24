# Claude Code Instructions — PortSentinel AI

## Project context

Before writing any code, read `plan.md` (complete technical blueprint) and
`progress.md` (phase-by-phase build tracker).

- Implement one phase at a time. Do not start Phase N+1 until the gate
  condition for Phase N is verified.
- If `plan.md` specifies exact code for something, use it. Do not rewrite it
  in a "simpler" way unless you flag the tradeoff first (Rule 1).
- If `plan.md` and these rules conflict, follow Rule 1: surface the conflict,
  state the tradeoff, and ask.

---

## Rule 1 — Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs. Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

---

## Rule 2 — Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it. Ask yourself:
  "Would a senior engineer say this is overcomplicated?" If yes, simplify.
- If a component exceeds 150 lines, stop and ask whether it should be
  split — don't split it unilaterally.

**Exception:** Follow the file structure defined in `plan.md` exactly.
The utility files (`vesselClassifier.js`, `contextBuilder.js`,
`responseParser.js`, `weatherMapper.js`) are intentional architectural
decisions, not speculative abstraction. Do not inline them.

---

## Rule 3 — Surgical Changes

Touch only what you must. Clean up only your own mess. When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

---

## Rule 4 — Goal-Driven Execution

Define success criteria. Loop until verified. Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria
("make it work") require constant clarification.

---

## Progress tracking

After completing any task or group of tasks, update `progress.md`:

- Tick the checkbox for every completed item: change `- [ ]` to `- [x]`
- Update the "Current phase" line at the top when a phase gate is passed
- Update "Last updated" with today's date
- Do not tick items you haven't verified — only mark done what you
  confirmed working

Do this before moving to the next task. Not at the end of the session.
