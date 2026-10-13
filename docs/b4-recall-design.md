# B4 Phase 1: recall mechanisms actually available in Pi

Scope: what Pi genuinely supports for "make the agent aware memory exists",
"remind contextually", "retrieve a little before the task", and "stay
completely silent when memory is irrelevant". Every item below was checked
against the installed Pi (`pi --version`, `@earendil-works/pi-coding-agent`
types and `docs/extensions.md`) or against a live local probe — not against
assumptions.

## Mechanisms, overhead, failure modes

| # | Mechanism | Where verified | Overhead | Failure modes | Verdict |
|---|---|---|---|---|---|
| 1 | Tool `promptSnippet` — one line in the default system prompt's "Available tools" section | `ToolDefinition.promptSnippet` in `dist/core/extensions/types.d.ts`; tools without a snippet are *omitted* from that section (this is why B3's tools were declared but easy to miss) | ~15–25 tokens per run, only while the tool is active | Stays silent when the tool is inactive/absent | **Use for condition C** |
| 2 | Tool `promptGuidelines` — bullets appended to the default `Guidelines` section, de-duplicated by `buildRules()` | `ToolDefinition.promptGuidelines`; `buildRules` seen in the installed bundle (dedupes normalised duplicates) | ~30–40 tokens per run | Verbose guidance becomes procedure-teaching; keep to one short bullet | **Use for condition C (one bullet max)** |
| 3 | `before_agent_start` → `systemPromptOptions.sections[<name>] = text` (structured, transcript-diffed) | Live probe `.scratch/b4-probe.log`: handler fired in *print* mode, `sections` carried `b4_memory_preview`, 15ms | Preview text + section tag; capped by our own budget | Preview content is untrusted memory in a *system* section — must be fenced and labelled untrusted, never instructions; empty result must be an explicit no-relevant-memory outcome | **Use for condition D (disposable harness only)** |
| 4 | `before_agent_start` → `promptGuidelines.push(...)` | Same probe: the array is present and mutable | Same as (2) | Same as (2) | Available; redundant with (2) once tools carry their own bullet |
| 5 | Return `systemPrompt` / `forceSystemPrompt` from `before_agent_start` | `docs/extensions.md`: replaces the whole prompt for that run | Replaces everything — loses Pi's default prompt | Highest blast radius; easy to silently drop tool rules | **Rejected** |
| 6 | `pi.sendUserMessage` / steering after start | `docs/extensions.md` event table | Extra round trip and visible message | Turns a pre-task preview into mid-task noise; not pre-task | Rejected |
| 7 | Shadow pre-task retrieval (`src/pi/shadow.ts`) | B2 research: `wouldInject: false` always | ~0 (log only) | Answers nothing for the model | Reused as the *measurement* channel for D's would-have-injected text |
| 8 | MCP server / daemon / embeddings | Not needed; forbidden by mission constraints | High | Unbounded authority | Rejected |

## What Phase 1 decides

- **Awareness (mechanism 1)** fixes the B3 defect directly: B3's transcript
  shows the tools were *declared* but never appeared in "Available tools",
  and the model never called them. A snippet puts the capability where the
  model looks first, without teaching a procedure.
- **Contextual reminder** stays a single guideline bullet, not a per-turn
  prompt: Pi appends it only while the tools are active, so it cannot force
  a lookup on turns where memory is off/unavailable.
- **Pre-task preview (mechanism 3)** is proven viable and cheap (15ms,
  synchronous store open), but is wired **only into the disposable trial
  harness** behind `SPEEDY_KEEPER_PREVIEW=1`. No production hook is added:
  the existing `sk-runtime-no-hooks` Terrorbat keeps proving there is no
  ambient injection surface unless the experiment explicitly enables it.
- **Silence by construction:** every mechanism above is conditional on the
  tools being registered (i.e. `SPEEDY_KEEPER_DB`/extension present and not
  `SPEEDY_KEEPER_DISABLED=1`), and the preview returns an explicit
  "no relevant memory" outcome instead of empty text.

## Conditions this enables (Phase 2)

| Condition | Implementation |
|---|---|
| A baseline | no extension (unchanged) |
| B voluntary | extension registers tools only (unchanged) |
| C discovery hint | B + `promptSnippet` on `memory_search` + one `promptGuidelines` bullet |
| D selective recall | C + bounded, fenced pre-task preview injected as a structured section by the harness-only `before_agent_start` handler |

Each condition differs from its neighbour by exactly one mechanism, so the
comparison attributes cause instead of bundling changes.
