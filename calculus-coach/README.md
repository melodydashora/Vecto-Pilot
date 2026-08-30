# Calc Coach — adaptive, mastery-gated AP Calculus BC tutor

Calc Coach teaches the full AP Calculus BC curriculum (all 10 College Board
units) and only lets the learner move forward when the current material is
actually mastered. It adapts to prior knowledge (a placement check), to ongoing
performance (per-skill difficulty laddering and weakest-skill-first practice),
and to forgetting (spaced review that recommends but never blocks).

It was designed for one specific learner: an autistic professional software
developer. The design decisions that follow from that are listed below — they
are features, not afterthoughts.

## Running it

Zero dependencies. Node 18+.

```bash
cd calculus-coach
node server.js          # serves on $PORT or 3000
```

**On Replit:** set the run command to `node calculus-coach/server.js` (or make
a Replit workflow task that runs it). The server binds `0.0.0.0` and reads
`PORT` from the environment, which is exactly what Replit's webview expects.
There is no `npm install` step, so a corrupted `node_modules` can never take
this app down.

Tests and content validation:

```bash
npm test                # engine unit tests (node:test, no dependencies)
npm run validate        # validates every unit content file against the schema
```

## How the learning model works (the exact rules)

Everything below is deterministic and visible to the learner in-app (Settings →
"How this app decides things"). No hidden scoring.

- **Skills.** Each unit has 4–8 skills. Every question is tagged with one skill
  and a difficulty 1–3.
- **Mastery score (0–100 per skill).** Each answer updates an exponential
  moving average: `new = 0.3 × credit + 0.7 × old`, where credit is 1 for
  correct with no hints, 0.5 for correct with hints, 0 for incorrect. Five
  clean correct answers reach mastery (80) from zero; a wrong answer drops the
  score by about a third of the way to zero — recoverable by design.
- **No mastery on easy questions alone.** Until the learner has a recent
  correct answer at difficulty ≥ 2, the displayed score is capped at 70.
- **Difficulty ladder.** Per skill, position 1–3. Clean correct → up one.
  Wrong, or correct only after 2+ hints → down one. Adaptive practice serves
  questions at the current ladder position, weakest skill first, never the
  same question twice in a row.
- **Mastery Check gates progression.** It opens when every *core* skill in the
  unit is ≥ 80. It is 8 questions at difficulty ≥ 2 drawn round-robin across
  core skills (one strong skill can't carry it), needs 7 correct, allows no
  hints, and has no time limit. Passing unlocks the next unit. Retakes are
  unlimited and always draw a fresh sample. **Units never re-lock.**
- **Placement check (optional).** Up to 3 questions per unit starting at
  Unit 1; a unit places out on 2 correct. Stops at the first unit that doesn't
  place out. Placed units unlock and count as "passed by placement", with
  their core skills seeded to 85 so review still has something to measure.
- **Spaced review.** A mastered skill untouched for 3+ days appears in Review.
  Review is explicitly recommended-not-required: falling behind on review
  never locks anything, because unpredictable regression would be punishing.

## Design decisions for this learner

- **One layout, everywhere.** Header, navigation, breadcrumb, and footer never
  move or change. Every view starts with "You are here: …".
- **All rules stated up front, completely.** The Mastery Check screen lists
  exactly what will happen before it starts, including what is shown after
  each answer and what failing does (nothing).
- **A "What happens next" panel** on unit and practice-summary screens, so the
  path forward is always explicit: lessons → practice → Mastery Check → next
  unit.
- **Literal language.** No idioms, no exclamation marks in teaching text, no
  rhetorical questions. Wrong answers get "Not yet." plus the exact
  misconception behind the chosen distractor and the full worked solution —
  never shaming phrasing, never a red flash.
- **Calm palette, zero motion, zero sound.** Incorrect uses amber, not
  alarm-red. There are no animations or transitions at all.
- **No timers by default.** An optional elapsed-time counter (counts up, never
  down) can be turned on in Settings for exam pacing practice; the app itself
  never imposes time pressure.
- **Two-step answering.** Select or type, *then* press "Check answer" — a
  stray click can never submit an answer.
- **`// for coders` callouts.** Every lesson maps the concept to a precise
  programming analogy (limits ↔ loop convergence, derivatives ↔ diffs over a
  shrinking step, Riemann sums ↔ reduce/accumulate, Taylor series ↔ successive
  approximation, Euler's method ↔ explicit time-stepping), including where the
  analogy breaks.
- **Full keyboard operability**, visible focus outlines, `aria-live` result
  announcements, adjustable text size, and light/dark/system themes.

## Architecture

```
calculus-coach/
├── server.js              # zero-dep node:http server: static files + progress API
├── package.json           # no dependencies; scripts only
├── public/
│   ├── index.html         # shell; KaTeX via CDN for math rendering
│   ├── styles.css         # calm, motion-free, themeable design system
│   ├── engine.js          # ALL adaptive/mastery logic — pure functions, no DOM
│   └── app.js             # SPA: routing, views, rendering, persistence
├── content/
│   ├── manifest.json      # the 10 units, ordering, app-wide constants
│   ├── schema.md          # authoring contract for unit content
│   └── unit-01..10.json   # curriculum: skills, lessons, ~300 verified questions
├── scripts/
│   └── validate-content.mjs  # enforces schema.md; run via npm run validate
├── test/
│   └── engine.test.mjs    # node:test suite for the engine
└── data/                  # runtime progress storage (gitignored)
```

- **Progress persistence** is dual: every answer saves to `localStorage`
  immediately and to the server (`PUT /api/progress`, atomic tmp+rename write
  under `data/`) on a short debounce. On load the newer of the two wins, so
  progress survives both browser changes and server resets. Settings offers
  JSON export/import as a manual backup path.
- **The engine is pure and tested.** `public/engine.js` has no DOM or network
  access and is exercised by `test/engine.test.mjs` — the mastery math above
  is pinned by assertions, not prose.
- **Content is data, verified before shipping.** Unit files were authored
  per-unit, then independently re-solved question-by-question by verifier
  passes, then cross-audited (id uniqueness, BC topic coverage, difficulty
  balance) — and `validate-content.mjs` enforces the structural contract
  (including per-skill question minimums and math-delimiter balance) on every
  change.
- **Math rendering** is KaTeX, vendored locally under `public/vendor/katex/`
  (JS, CSS, and woff2 fonts, ~600 KB) so math renders with or without
  internet access — no CDN dependency at runtime.

## Adding or editing content

Read `content/schema.md`, edit the unit JSON, then run `npm run validate`.
The validator fails loudly on any structural problem: missing misconception
notes, unbalanced `$` delimiters, a core skill with too few hard questions, a
checkpoint referencing a question that doesn't exist, and so on.
