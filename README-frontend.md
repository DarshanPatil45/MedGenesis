# MedGenesis Frontend

AI Clinical Intelligence Command Center — a React SPA over the existing
MedGenesis FastAPI backend.

> **Synthetic data. Educational use only. Not medical advice or a diagnostic device.**

This refactor changed layout, navigation, visual system and page composition
only. No backend route, Pydantic schema, model, agent or safety behaviour was
modified, and no request/response shape was rewritten.

---

## Stack

React · TypeScript · Vite · React Router · Tailwind CSS v4 · motion/react ·
lucide-react · Recharts · Radix UI primitives · class-variance-authority ·
tailwind-merge · @fontsource.

**Not installed:** `reactflow`. Its only use was the agent DAG tab, which was
dropped — the backend returns `trace` as a flat `list[str]` with no node ids or
edges, so a graph would have required inventing topology.

### Tailwind v4 note

Tailwind v4 is CSS-first. There is **no `tailwind.config.js`** — the `@theme`
block at the top of `src/index.css` *is* the configuration. `src/design-system/
tokens.ts` mirrors those values for non-CSS consumers (Recharts series colours,
SVG gradients). Keep the two in sync.

---

## Design system

### Two visual layers

The composed/dense-data tension is resolved by splitting the language in two.
Mixing them is the main thing to avoid.

| | Shell layer | Data layer |
|---|---|---|
| Where | Top bar, stage headers, empty states | Tables, charts, forms, SHAP, evidence, trace |
| Treatment | Blueprint grid, soft colour wash, hairlines, large editorial type | White surface, 1px border, layered shadow |
| Classes | `.shell-glass`, `.shell-grid`, `.shell-wash`, `.text-gradient` | `.data-surface`, `.data-surface-raised`, `.data-table`, `.rule-fade` |
| Rule | Composition is allowed | Readability wins. **No wash behind data.** |

On a light ground, "premium" comes from elevation and precision, not glow —
hence the layered `--shadow-*` scale rather than any blur/bloom effect.

### Tokens (`src/design-system/tokens.ts` + `@theme` in `index.css`)

**Surfaces** — `page #F4F7FB` · `surface #FFFFFF` · `subtle #F7F9FC` ·
`border-strong #DBE3EE` · `border #E8EDF5`

**Text** — `ink #0B1220` · `ink-2 #3A4759` · `ink-3 #5B6880`

**Accents — two variants each.** The `base` is AA-contrast on white and is the
only one allowed for text and small marks; the `bright` sibling is for fills:
chart series, gauge arcs, bars.

| Role | Base (text) | Bright (fill) |
|---|---|---|
| Primary | teal `#0B6E63` | `#15B79E` |
| Primary alt | blue `#1349B8` | `#2E90FA` |
| AI / agent | violet `#6938EF` | `#875BF7` |
| Warning / review / simulated | amber `#B54708` | `#F79009` |
| High risk / blocked | rose `#C01048` | `#F04438` |

> The base teal and blue were darkened from `#0E9384` / `#1570EF`, which
> measured 3.8:1 and 4.58:1 on white — the first fails AA outright for small
> text and the second drops below it on its own `/12` tint. The current values
> clear 4.5:1 on white *and* on their tinted chip backgrounds.

**Typography** — display `Instrument Serif` (stage titles only) · UI `Inter` ·
mono `JetBrains Mono`. Self-hosted via `@fontsource`.

**Radii** — 14px cards · 10px inputs · 999px pills.

**Elevation** — `--shadow-xs` … `--shadow-xl`, layered low-opacity shadows plus
an optional inner top highlight (`--ring-inset`).

**Motion** — 180–260ms micro, 400–600ms hero reveal, spring for panel slide.
Presets in `src/design-system/motion.ts`, each paired with `useReducedMotion()`;
`prefers-reduced-motion` is also enforced globally in CSS.

### Primitives (`src/design-system/primitives/`)

`Button` (cva variants) · `Card` + `CardLabel` · `Chip` / `ChipButton` ·
`Stat` / `StatRow` · `Meters` (`RatioBar`, `Sparkline`, `SectionIndex`) ·
`Drawer` (Radix Dialog) · `StageHeader` · `States` (`Skeleton`,
`TableSkeleton`, `ChartSkeleton`, `EmptyState`, `ErrorState`) · `Overlays`
(Tooltip, Tabs, Popover, ScrollArea, `LabeledSlider`).

All overlays are Radix-backed, so focus trapping, Escape handling, scroll
locking and ARIA wiring are inherited rather than reimplemented.

`src/design-system/visuals/TwinOrb.tsx` is the ambient Digital Twin visual —
SVG/CSS only, no canvas loop, no per-frame JS. It renders real `Patient`
fields, or a dimmed unlabelled state when nothing is selected.

`src/design-system/visuals/AnatomicalBackdrop.tsx` is the page-level ambient
ground: a deterministic isoline field mounted once in `AppShell`, fixed at
`z-0` with content lifted to `z-10`. Contours are drawn from summed sinusoids
(no `Math.random()`), so the composition is stable across renders. Every
stroke sits at ≤3.5% alpha and a white vignette feathers the field toward the
centre; data surfaces paint opaque `--color-surface` over it, so measured text
contrast is identical to the flat background.

> **On photography:** decorative imagery is deliberately sparse. Third-party
> photos are not used — see `_unused-assets/README.md` for one asset that was
> pulled from `public/` for licensing reasons. Ambient visuals are generated
> in SVG instead: no licence risk, no image bytes, and they scale to any
> viewport.

---

## Layout

`src/layouts/AppShell.tsx`

- **No persistent sidebar.** A compact 56px top command bar carries:
  logo → journey breadcrumb → patient chip → finder → safety pill → (mobile) menu.
- **Journey breadcrumb** — Patient → Digital Twin → Models → Evidence →
  Synthesis → Safety. The stage owning the current route gets `aria-current="step"`.
  Mapping lives in `src/layouts/journey.ts`.
- **Secondary nav is contextual**, per screen — not a persistent rail.
- **Patient chip** (`PatientChip.tsx`) shows the selected synthetic patient and
  opens a switcher popover.
- **Finder** (`GlobalFinder.tsx`) filters the already-loaded patient list and the
  app's own routes **client-side**. There is deliberately no request: the backend
  exposes no general search endpoint.
- **Safety pill** carries the required disclaimer on every route, with the full
  sentence always in the accessibility tree even when visually shortened.

Pages use asymmetric 12-column grids (7/5, 8/4, 4/3/5) — never a grid of
equal-weight cards as the primary layout.

---

## Screens (`src/features/<screen>/`)

Each folder holds the page, its sub-components, and calls the **existing**
`src/api/client.ts`. Request/response shapes were not touched.

| Tier | Screen | Composition |
|---|---|---|
| A | **Patient Intake** | Full-bleed stage (editorial headline + real cohort readings + 6-step journey rail + `TwinOrb`), then two paths side-by-side: seeded scenarios and a horizontally-scrolling patient rail (7 cols) vs. a guided 3-step create drawer (5 cols), closing on the live `SystemStrip` |
| A | **Digital Twin** | Identity + risk snapshot metrics, then a Recharts `ScatterChart` canvas with one lane per real `event_type` and brush-to-zoom; click a point → contextual record drawer. Side rail: filters, recorded range, recent activity. Materialized state collapsed |
| A | **Clinical Analysis** | Editorial prompt composer with example chips, then a three-column synthesis: Grounded Evidence (4) · Model Comparison with Δ (3) · AI Synthesis with uncertainty band and inline `[E#]` pills (5). SHAP diverging chart below |
| B | **Screening** | Two-panel: radial gauge output + metric instrumentation; RF vs XGB scored side-by-side on the same patient; global feature-importance bar chart |
| B | **What-if Lab** | Free-text scenario parsed by the backend's deterministic NLP module, *or* Radix sliders for the 4 supported deltas + horizon; baseline↔scenario diff with animated delta; trajectory chart; assumptions. "Simulation only" badge |
| B | **Agent Trace** | Vertical step timeline built from the real trace strings + what the run produced |
| B | **Grounded Chat** | Conversation anchored to the selected patient; inline evidence pills open the real source in a drawer |
| C | **Care Plan** | Editorial domain sections (nutrition / activity / monitoring), notes, narrative, evidence grounding. Print-friendly (`@media print`) |
| C | **Safety** | Severity-grouped audit log, filters, active policy. Institutional tone, no cinematic treatment |

### Global behaviours

- **Loading** — skeletons shaped like the final layout. No mid-page spinner.
- **Empty** — icon + one-line reason + suggested action.
- **Error** — inline, non-blocking, with retry. Supplementary calls fail
  independently so they never hide a primary result.
- **REST only** — no SSE/WebSocket, no simulated streaming.

---

## Data honesty rules

Enforced throughout; `mock`/`fake`/`lorem`/`dummy`/`placeholder` greps clean.

- Every visible number, label and citation comes from a real backend response.
- Absent data renders an empty state, never a placeholder value.
- The safety gate renders **every** returned reason verbatim — nothing is
  truncated, softened or hidden by verdict.
- Per-patient SHAP is parsed from the backend's own deterministic prose
  (`clinical_agent.py` renders `f"{name} ({value:+.3f})"`, top-5). If the
  template ever changes, the parser yields nothing and the UI falls back to the
  plain claim rather than inventing values.
- The production model returns no per-patient magnitudes, so it is shown as a
  ranked list — rank position is the only number.

### Documented gaps

`docs/frontend-audit.md` lists 12 requested features with no backing endpoint.
Notable ones visible in the UI:

- No `confidence` field and no calibration metric exist → not shown.
- What-if offers 4 deltas. **BP and glucose are absent** — BRFSS records
  neither, and glucose was deliberately removed from the simulation agent.
- PubMed `authors` and `year` are parsed by the backend but dropped before the
  response, so citations show title / journal / DOI / link only.
- `trace` has no duration or status → the timeline shows neither.
- Care Plan has no sleep domain; `sources[]` is plan-level, not per-item.

---

## Verification

```bash
npm run dev        # http://localhost:5173, proxies /api → :8010
npx tsc --noEmit   # typecheck
npx vitest run     # 25 tests
npm run build      # production build
```

Verified at 1440 / 1280 / 1024 / 768 / 390 — no horizontal overflow, no console
errors on any of the 9 routes.

Lighthouse accessibility: **100 on all nine routes**.
