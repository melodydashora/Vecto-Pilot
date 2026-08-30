# Calc Coach content schema (authoring contract)

Every unit file is `content/unit-NN.json` (NN = zero-padded unit number). It must
validate cleanly: `node calculus-coach/scripts/validate-content.mjs unit-NN`.

## Top-level shape

```json
{
  "id": "unit-01",
  "number": 1,
  "title": "Limits and Continuity",
  "overview": "2–4 sentences: what this unit covers and why it matters, in literal, concrete language.",
  "skills": [ Skill, ... ],
  "lessons": [ Lesson, ... ],
  "questions": [ Question, ... ],
  "masteryCheck": { "questionCount": 8, "passCount": 7 }
}
```

Quantities per unit: **3–6 lessons**, **24–40 questions**, **4–8 skills**.
The mastery-check pool (questions with `difficulty >= 2` on core skills) must
have **at least 12** questions so retakes get a fresh sample.

## Skill

```json
{ "id": "u1-limit-definition", "name": "Understanding limit notation and definition", "core": true }
```

- `id`: starts with `u<number>-`, kebab-case, unique across the whole app.
- `core`: core skills gate the mastery check. Core skills need >= 4 questions,
  >= 2 of them at difficulty >= 2, and >= 1 at difficulty 3. Non-core need >= 2.

## Lesson

```json
{
  "id": "u1-l1",
  "title": "What a limit is",
  "skillIds": ["u1-limit-definition"],
  "estMinutes": 12,
  "sections": [
    { "type": "concept", "html": "<p>...</p>" },
    { "type": "coder-note", "html": "<p>...</p>" },
    { "type": "worked-example", "title": "Evaluate ...", "steps": [ { "text": "...", "math": "..." } ] },
    { "type": "checkpoint", "questionIds": ["u1-q001", "u1-q002"] }
  ]
}
```

Section types:
- `concept` — the teaching text. Short paragraphs. Literal language: no idioms,
  no sarcasm, no rhetorical questions. Define every term before using it.
- `coder-note` — optional but strongly encouraged (>= 1 per lesson): a genuine
  programming analogy for the concept (the learner is a professional coder).
  Examples: a limit as the convergence of an iterative loop; the derivative as
  the diff between adjacent states over a shrinking step; Riemann sums as
  `reduce`/accumulate; Taylor series as successive-approximation refinement;
  Euler's method as explicit time-stepping in a game loop. Make the analogy
  precise — say where it holds and where it breaks.
- `worked-example` — full solution shown step by step. `steps[].text` explains
  the step; `steps[].math` (optional) is a display-math LaTeX string.
- `checkpoint` — 1–3 question ids from this unit's pool, placed after the
  concept they test. Every lesson ends with a checkpoint.

Every lesson: 2–5 concept/coder-note/worked-example sections plus checkpoints.

## Question

```json
{
  "id": "u1-q001",
  "skillId": "u1-limit-definition",
  "difficulty": 1,
  "type": "mc",
  "prompt": "<p>Evaluate $\\lim_{x \\to 3} (2x + 1)$.</p>",
  "choices": ["$5$", "$6$", "$7$", "The limit does not exist"],
  "answerIndex": 2,
  "misconceptions": [
    "This is $2x - 1$ at $x = 3$; check the sign of the constant term.",
    "This is $2x$ at $x = 3$; the $+1$ still applies in the limit.",
    null,
    "The function is a polynomial, so the limit equals the function value."
  ],
  "hints": [
    "The function $2x + 1$ is a polynomial. Polynomials are continuous everywhere.",
    "For a continuous function, $\\lim_{x \\to a} f(x) = f(a)$. Substitute $x = 3$."
  ],
  "solution": [
    { "text": "Polynomials are continuous at every real number, so the limit equals the function value.", "math": "\\lim_{x \\to 3} (2x+1) = 2(3) + 1" },
    { "text": "Evaluate.", "math": "2(3) + 1 = 7" }
  ]
}
```

Numeric questions use `"type": "numeric"` with `"answer": 7` (a finite number)
and optional `"tolerance": 0.001` (absolute; default 0.001) instead of
`choices`/`answerIndex`/`misconceptions`. Design numeric answers to be clean
(integers or short decimals); tell the learner the expected form in the prompt
(e.g. "Round to two decimal places." — then set tolerance 0.005).

Rules:
- `difficulty`: 1 = direct application of one idea; 2 = multi-step or requires
  choosing the method; 3 = AP-exam-level, combines skills or has a twist.
  Spread each skill's questions across difficulties.
- `hints`: 2–3, ordered gentle nudge → method reveal. A hint never states the
  final answer.
- `solution`: 2–6 steps. Complete enough that a stuck learner can follow every
  step. `math` fields are display LaTeX (no `$` delimiters inside `math`).
- `misconceptions` (mc only, required): same length as `choices`; `null` for
  the correct index; each other entry says *specifically* what error produces
  that choice, phrased neutrally (never "you forgot" — say "this is the value
  when the chain rule factor is omitted").
- Wrong choices must be plausible errors (sign slips, dropped chain-rule
  factor, off-by-one on power rule), not random numbers.

## Formatting rules (enforced by validator)

- Math in `html`/`prompt`/`choices`/`hints`/`misconceptions`/`text` fields uses
  `$inline$` and `$$display$$` delimiters (KaTeX). Escape backslashes for JSON:
  `$\\frac{1}{2}$`. Never use `\\(`, `\\)`, `\\[`, `\\]`.
- Every string must have an even number of `$` characters. To write a literal
  dollar sign, use `&dollar;`.
- Allowed HTML tags: `p, ul, ol, li, strong, em, code, br, table, thead,
  tbody, tr, th, td, blockquote`. Nothing else. No inline event handlers, no
  `<script>`, no `style=` attributes, no external images.
- KaTeX-supported LaTeX only (no `\\begin{tikzpicture}` etc.). `aligned`,
  `cases`, `frac`, `int`, `sum`, `lim`, `vec` are all fine.
- Tone: literal, concrete, calm. No exclamation marks in teaching text. No
  idioms or figures of speech. Address the learner as "you". Feedback text
  never shames; write "this choice comes from ..." not "you made the mistake
  of ...".
