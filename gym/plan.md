# Gym Tracker — Plan

A StrongLifts-style workout tracker: single-page app, no server, no build step,
hosted on GitHub Pages. Mithril for views, plain JS objects/functions for the
model, `localStorage` for persistence, JSON/CSV export for backup and analysis.

This doc is the design reference before implementation starts. It covers the
data model first (per the project's MVC preference), then how that model
drives the views, then the supporting pieces (storage, progression, PWA).

Decisions below marked **(confirmed)** came from discussion with David.
Everything else is a proposal — flag anything you want changed before or
during implementation.

---

## 1. Conventions carried over from the rest of the repo

Looked at `wim/`, `hearts/`, `pomodoro/`, `gratitude/` before writing this:

- Mithril is vendored at `libs/mithril.js`, loaded via `<script src="../libs/mithril.js">`
  before the app script — no bundler, no npm.
- Views are written as nested hyperscript arrays, e.g.
  `["div.card", { onclick: fn }, [["h2", "Title"], ...]]`, passed to `h(...)`
  or returned directly from a component's `view()`.
- `libs/tacit-css.css` (classless base) + `common/style.css` (shared button/
  section styles: `.btn-primary`, `.btn-danger`, `.container`, etc.) are
  loaded on every page, then each app adds its own small stylesheet on top.
- State lives in plain JS objects with methods (e.g. `GratitudeModel`,
  `Results`, `Timer`), not a framework store. Mutating state + calling
  `m.redraw()` is the update pattern.
- Two persistence patterns exist in the repo: `localStorage` (wim, hearts)
  and a linked local JSON file via the File System Access API
  (`common/file-linker.js`, used by gratitude/pomodoro).

## 2. Persistence — **(confirmed) `localStorage` + JSON/CSV export**

`localStorage` is the source of truth, written on every mutation (same
pattern as `wim`'s `Results.save()`). Reasons this was picked over
file-linking for this app specifically:

- The File System Access API (`common/file-linker.js`) **does not exist in
  Safari/iOS at all** — not degraded, just absent. Since an installable iOS
  PWA is a stated stretch goal, file-linking would either block that goal or
  require building and maintaining a second storage path just for iOS. Not
  worth it here.
- "Export everything as JSON/CSV" is already a required feature, not a nice
  extra — so the export button doubles as the backup/sync mechanism instead
  of needing a second storage system.

Data shape stored under a couple of keys:

- `gym.plans` → `WorkoutPlan[]` (see §3)
- `gym.sessions` → `WorkoutSession[]` (logged history, see §5)
- `gym.settings` → `{ activePlanId, unit: 'kg' | 'lb' }`

Write-through on every mutation, same as the rest of the repo. No debouncing
needed at this data size (a lifetime of gym logs is a few hundred KB of JSON
at most, well under the 5MB `localStorage` limit).

### Export / Import

- **Export JSON** — single file, `{ plans, sessions, settings }`, full
  fidelity round-trip. This is the "back up everything" / "move to a new
  device" option. Mirrors `Results.exportData()` in `wim/script.js`.
- **Export CSV** — one row per *logged set* (not per plan — plans are a tree,
  CSV is for spreadsheet analysis of what you actually did):
  `date, workoutPlan, workout, exercise, setIndex, weight, unit, reps, repRangeMin, repRangeMax`.
- **Import JSON** — replaces `plans`/`sessions`/`settings` wholesale, same
  "paste a file, confirm, done" pattern as gratitude's import. No CSV import
  (CSV is lossy/one-way, JSON is the real backup format).

## 3. Data model

Pure data + pure functions, no Mithril in this layer, so it's easy to reason
about and test independently of the view. Proposed home: `gym/model.js`.

### WorkoutPlan

```js
{
  id: "plan-1",
  name: "Starting Strength",
  workouts: [Workout, Workout, ...],   // the distinct workouts, e.g. A and B
  cycle: ["workout-a", "workout-b", "workout-a"], // explicit order of workout ids
  cursor: 0,                            // index into `cycle` — which slot is "next"
}
```

`cycle` is an explicit array of workout ids rather than an inferred rotation,
so "A, B, A" or "A, B, C, A" (or anything irregular) is just data, no special
cycling logic. Finishing a session advances `cursor` by 1 (wrapping around
with `%`).

### Workout

```js
{
  id: "workout-a",
  name: "A",
  nodes: [ExerciseNode, ExerciseNode, ...],   // ordered top-level list
}
```

### ExerciseNode (recursive — this is how supersets/circuits work)

A node is either a **leaf** (a single exercise) or a **group** (a superset or
small circuit — "a list of other exercises" per the spec). Same shape, one
extra field:

```js
// Leaf exercise
{
  id: "node-3",
  kind: "exercise",
  name: "Bench Press",
  sets: 3,
  repRange: { min: 8, max: 12 },
  weight: 60,             // current working weight, in `unit`
  unit: "kg",
  restSeconds: 120,
  progression: { type: "double-progression", increment: 2.5 },
  children: null,
}

// Group — e.g. 3 exercises done back-to-back, for 4 rounds
{
  id: "node-7",
  kind: "group",
  name: "Superset: Curls + Triceps",
  sets: 4,                // number of *rounds* through the children
  repRange: null,          // not used on a group
  weight: null,
  unit: null,
  restSeconds: 60,         // rest taken after completing one full round
  progression: null,
  children: [ExerciseNode, ExerciseNode, ExerciseNode],  // leaves, own rep/weight/rest
}
```

Rationale for recursion rather than a separate "Superset" type: a group's
children are themselves full exercise nodes with their own name/reps/weight,
and nothing stops a child from someday being a group too (a circuit of
supersets). One shape, walked recursively, keeps the model and the renderer
simple — `flattenLeaves(workout)` (a pure helper) walks the tree and returns
every leaf in order, which is what most of the app actually needs (logging,
history, CSV export).

A leaf's `sets` is the number of sets *of that exercise*; a group's `sets` is
the number of rounds through its children (children don't carry their own set
count — one pass through the children list = one set of each).

### Progression

`progression` is a small tagged object so other progression schemes could be
added later without changing the model shape — but only `double-progression`
is implemented:

```js
{ type: "double-progression", increment: 2.5 }
```

## 4. Double progression — the algorithm

**(confirmed) Auto-increase, always editable after.**

Given `repRange = { min, max }` and the set of logged reps for an exercise in
a finished session:

1. If the exercise wasn't done this session (e.g. skipped/unavailable
   equipment), no change.
2. If every logged set has `reps >= repRange.max`, the exercise "topped out":
   `weight += progression.increment` for next time this exercise appears,
   and next session's rep target effectively resets to chasing `min` again
   (reps aren't stored as a separate "current target," they're just whatever
   you log — the UI shows the range `8–12` every time, not a moving target
   number).
3. Otherwise, weight is unchanged — you're still working up through the rep
   range at the current weight.
4. No auto-deload logic (e.g. dropping weight after repeated failure to hit
   `min`) — out of scope for v1. Worth a `progression.type` variant later if
   wanted; flagged here so it isn't forgotten, not because it's planned.

Weight changes are applied to the plan's node (`ExerciseNode.weight`)
immediately after the session is marked finished, with a small "🔺 weight
increased to 62.5kg" notice in the finish summary. Since it's just a normal
field on the node, the user can open the plan editor and override it by hand
at any time — "editable after" is free, not extra code.

This is implemented as a pure function so it's testable in isolation:

```js
// (exerciseNode, loggedSets: {reps, weight}[]) -> { nextWeight, increased }
function applyDoubleProgression(exerciseNode, loggedSets) { ... }
```

## 5. Session flow (live logging, free order)

**(confirmed) Live logging with a rest timer, but exercises can be done out
of sequence** — e.g. if a machine is taken, skip ahead and come back. This
shapes the model and the view more than anything else in the app, so it's
worth spelling out precisely.

### WorkoutSession (the log entry created per gym visit)

Two shapes for `entries`, used at two different times — this split matters
for §6.1's graph view, so it's worth calling out explicitly rather than
glossing over it:

- **Live shape** (while a session is in progress): a dict keyed by node id
  (dotted path for nested group children), same as before — cheap to check
  "how many sets logged for this node vs. its target" while the user is
  free-jumping between exercises.
- **Stored shape** (once the session is finished and written to history): a
  flat array, one entry per exercise *leaf*, each snapshotting the exercise's
  **name** (and unit) at the time, not just its id:

```js
{
  id: "session-42",
  planId: "plan-1",
  workoutId: "workout-a",
  date: "2026-08-23",
  startedAt: "2026-08-23T10:02:00Z",
  finishedAt: "2026-08-23T10:51:00Z",   // null while in progress
  entries: [
    {
      nodeId: "node-3",
      name: "Bench Press",       // snapshot, not a live lookup
      unit: "kg",
      sets: [ { reps: 10, weight: 60 }, { reps: 9, weight: 60 }, { reps: 8, weight: 60 } ],
    },
    {
      nodeId: "node-7.child-1",
      name: "Bicep Curl",
      unit: "kg",
      sets: [ { reps: 12, weight: 8 } ],
    },
    ...
  ],
}
```

Why snapshot the name instead of looking it up live from the plan each time:
history has to keep reading correctly after the plan is edited or the
exercise is deleted (§11), and — new in §6.1 — the per-exercise progress
graph groups history **by exercise name across every session, plan, and
workout it ever appeared in**, not by node id (a node id is only stable
within one workout; the same lift showing up in two different workouts, or
surviving a plan edit, needs to be recognized as "the same exercise" for the
graph to be useful). Name-based grouping is a simple, good-enough identity
for a personal tracker — it does mean renaming an exercise splits its graph
history at the rename point, which seems like the right tradeoff (rarely
done, and arguably *should* start a new line if the exercise substantively
changed).

`flattenSession(liveEntries, workout)` (pure helper) does the live→stored
conversion at Finish time. Live-shape lookups (`isNodeComplete`, "how many
sets so far") stay id-keyed since that's the natural key while a node's spot
in the current workout tree is still known and relevant.

### The active-session view

- One in-progress `WorkoutSession` at a time, held in app state and
  written to `localStorage` after every logged set (so a page reload/crash
  mid-workout doesn't lose sets — same "save on every mutation" pattern as
  the rest of the app, not a special case).
- The screen shows every top-level node from the workout, in plan order, each
  as a compact row/card: name, `sets done / sets target`, current
  weight × rep range. A node with all sets logged gets a "done" visual state
  but stays visible and tappable (in case a number needs fixing).
- Tapping a node expands it into the logging control: big weight and rep
  fields (steppers, not typing on a phone — few taps), prefilled with the
  node's target weight/rep-range midpoint, a "Log Set" button. Logging a set
  appends to `entries`, collapses back to the compact row, and (if the node
  has `restSeconds`) starts the rest timer.
- Because order is free, there's no "next exercise" auto-advance — after
  logging a set the user picks whatever's next themselves. This is simpler
  to build than a smart "what's next" heuristic and matches how gym time
  actually works (equipment availability, not a fixed script).
- A group node expands to show its children as sub-rows sharing the group's
  round counter; logging a set for the last child in a round increments the
  group's round count.
- **Finish Workout** button, always available (not gated on every set being
  done — you don't always finish everything). On finish: `finishedAt` is
  set, double progression (§4) runs per completed node, `plan.cursor`
  advances to the next slot in `cycle`, and the session moves from
  "in-progress" into history.

### Rest timer

- A single global timer (not per-exercise) — realistically only one rest
  period is ever "the current one" even with free exercise order, so this
  avoids juggling concurrent timer state for no real benefit.
- Starts automatically after logging a set on a node that has `restSeconds`,
  counts down, and is visible as a small persistent banner/bar so it doesn't
  block moving on to log a different exercise while resting.
- Manual "skip rest" and "+15s" controls (cheap to add, standard on every
  gym app, avoids the timer being annoying rather than useful).

## 6. Views

No router — same pattern as `wim`'s `App.currentMode`, just more states.
Kept as a plain `App.page` string switched by nav buttons, since the app
doesn't need deep-linkable URLs and this stays consistent with the rest of
the repo. (`m.route` would be a reasonable upgrade later for back-button
support; not needed for v1.)

1. **Home** — the default screen, and the one that has to satisfy "everything
   visible at a glance, few taps." Shows: active plan name, the next workout
   in the cycle (e.g. "Next: Workout B"), one big **Start Workout** button.
   Below that, quick links to Plans / History / Settings.
2. **Active Session** — described in §5.
3. **Session Finish Summary** — brief screen after tapping Finish: sets
   logged, any weight increases from double progression, "Done" returns
   home. (Could be folded into Home as a transient banner instead of a
   separate page — worth trying in-browser before committing either way.)
4. **Plans** — list of plans, switch active plan, create new plan, delete
   plan, open a plan for editing.
5. **Plan Editor** — plan name, the list of workouts (add/remove/rename), and
   the `cycle` order as a simple editable sequence (e.g. tap workout badges
   in the order you want them to repeat: A, B, A).
6. **Workout Editor** — a workout's ordered node list. Add exercise, add
   group (then add exercises into the group), reorder (drag or up/down
   buttons — drag is nicer but up/down is far less code and fine for lists
   this short), edit a node's name/sets/rep range/weight/unit/rest/increment
   inline, delete a node.
7. **History** — see below, this one has more to it.
8. **Settings** — unit toggle (kg/lb), Export JSON, Export CSV, Import JSON,
   PWA install hint (see §8).

### 6.1 History, in detail

Four pieces, stacked top to bottom on one page — calendar + stats first
(the "at a glance" summary), then a Sessions/Progress toggle for the
detail underneath, matching `wim`'s existing `.history-tabs` pattern of
switching sub-content without a page change:

**a. Stat row.** Two numbers, computed once per render by pure helpers over
`sessions` (no new stored state — everything here is derived):

- **Total sessions** — `sessions.filter(s => s.finishedAt).length`.
- **Total weight lifted** — total *volume*, the standard strength-training
  sense of "weight lifted": `Σ (set.weight × set.reps)` over every set in
  every session. Formatted compactly for a stat tile once numbers get large
  (e.g. `128,450 kg` → `128.5k kg`).
- `totalWeightLifted(sessions)` and `totalSessions(sessions)` — pure
  functions in `model.js`, next to the progression helpers.

**b. Calendar.** Reuse `common/heatmap.js` as-is rather than building a new
one — it's already exactly this (GitHub-style year grid, count per day,
tooltip), already shared across `pomodoro` and originally lifted out of
`wim`. Wire it up the same way `pomodoro/script.js` does:

```js
// gym/index.html: <script src="../common/heatmap.js"></script>  (after mithril, before script.js)
SharedHeatmap.render(sessions.filter(s => s.finishedAt), { timestampField: 'finishedAt' })
```

No new code needed for the calendar itself — this is the "don't build what
already exists in the repo" case the model/storage split was set up for.

**c. Sessions tab (the table).** What was previously described here:
reverse-chronological list of finished sessions — date, workout, brief
summary (e.g. "3 exercises, 9 sets"). Tapping a row expands it to the full
per-exercise set breakdown, reading straight from that session's stored
`entries` (§5).

**d. Progress tab (the graph).** New. A `<select>` of exercise names —
populated by `distinctExerciseNames(sessions)`, a pure helper that walks
every session's `entries` and collects unique `name`s — defaulting to
whichever exercise was most recently logged. Choosing one renders a line
chart of that exercise's volume over time.

- **One point per session**, not per set: `exerciseSeries(sessions, name)`
  (pure helper) filters every session containing that exercise name, and for
  each takes that exercise's **volume for that session** (`Σ set.weight ×
  set.reps` across its logged sets that session) paired with the session's
  `date` — the same volume metric as the top-of-page stat (§6.1a), applied
  per exercise instead of summed across the whole workout, so the two stay
  read consistently: whole-workout volume trending up should track with the
  individual exercise lines trending up. Volume rewards more reps/sets at
  the same weight as well as heavier weight, which is a broader "getting
  stronger at this lift" signal than watching the top set alone. A top-set-
  weight or estimated-1RM (Epley: `weight × (1 + reps / 30)`) toggle is a
  reasonable v2 addition if isolating pure weight progression (closer to
  what double progression itself tracks) turns out to be wanted once
  there's real data to look at, but isn't needed to start.
- **Rendering**: a small pure SVG line-chart helper — points connected by a
  `<polyline>`, a circle per point (hoverable for the exact date/volume via
  `<title>`, same trick `common/heatmap.js` uses for its day tooltips), axis
  labels for date (x) and volume (y). No charting library — this is a
  couple dozen lines of `x = scale(date), y = scale(volume)` math, well
  within "few dependencies" and consistent with `common/heatmap.js` already
  hand-rolling SVG rather than pulling in a chart library.
- **Where it lives**: proposing `gym/chart.js` (a pure `renderLineChart(points, options)`
  function, no Mithril, called from the Progress tab's view) to start,
  rather than `common/`. `common/heatmap.js` itself only moved to `common/`
  once a *second* app (`pomodoro`) needed it — following that same pattern,
  a line chart is worth promoting to `common/linechart.js` later if another
  app in the repo turns out to want one too, but starting it local avoids
  guessing at a shared API prematurely.

## 7. File structure

```
gym/
  index.html        # shell: <main id="app-mount">, script tags, PWA <link>s
  style.css          # gym-specific styles on top of tacit-css + common/style.css
  model.js           # pure data model + helpers — NO Mithril here (§3, §4)
  storage.js         # localStorage read/write, JSON/CSV export+import
  chart.js           # pure SVG line-chart helper for the History Progress tab (§6.1)
  script.js          # Mithril components (views) + App state/glue (§6)
  manifest.json      # PWA manifest (stretch, §8)
  service-worker.js  # offline caching (stretch, §8)
  icons/             # PWA icons (stretch, §8)
```

Splitting `model.js` out from the view/glue code is the one deviation from
"everything in one `script.js`" that the rest of the repo uses — worth it
here specifically because "focus on the data model first" was called out as
a goal, and because the model (plan/session shapes, progression math,
flatten/validate helpers) is genuinely reusable and testable independent of
Mithril, unlike e.g. `wim`'s timer logic which is inherently tied to its
view. `storage.js` split out for the same reason: export/import/CSV
formatting is pure-ish data munging, not view code.

`index.html` also loads `../common/heatmap.js` (in addition to
`../libs/mithril.js`) — the History calendar (§6.1) reuses it directly
rather than reimplementing a heatmap.

## 8. CSS

Reuse `libs/tacit-css.css` + `common/style.css` (already provides
`.container`, `.btn-primary/success/danger/secondary`, `section` cards) — no
new component library. `gym/style.css` adds only what's actually new:
layout for the exercise list/rows, the rest-timer banner, the weight/rep
stepper control, group/superset nesting indentation.

Class names stay generic/composable per the stated preference — `.row`,
`.card`, `.stepper`, `.timer`, `.active`, `.done`, `.group` — combined via
descendant/modifier selectors (`.row.done`, `.card .stepper`) rather than
single-purpose names like `.set-and-rep-button`. A node "in progress" or
"resting" is a state class (`.active`, `.resting`) layered on the same
`.row`, not a different element.

## 9. PWA / installability (stretch goal)

Standard installable PWA: `manifest.json` (name, icons, `display: standalone`,
theme color) + a minimal `service-worker.js` caching the app shell (HTML/CSS/
JS + `libs/mithril.js`) so it opens instantly and works offline — genuinely
useful for a gym app, since gym wifi/signal is often bad. This part is
straightforward and works the same on Android and iOS.

### "Timer on the homescreen for iOS" — what's actually possible

Worth being upfront about this one: **iOS does not give web apps a way to
render a live-updating widget on the home screen.** That's a native-app-only
API (WidgetKit/Live Activities); there's no web equivalent, installed PWA or
not. So the literal ask — a ticking countdown visible on the home screen
without opening the app — isn't achievable as stated. Two things get close
and are worth building instead, both realistic:

- **Local notification when rest ends.** iOS Safari (16.4+) supports Web
  Push for PWAs added to the home screen. The rest timer, on completion,
  fires a notification ("Rest done — back to it") even if the phone is
  locked or you've swiped to another app. This covers the actual need (not
  staring at a countdown) rather than the literal ask (a countdown widget).
- **Screen Wake Lock** during an active session, so the countdown that *is*
  on-screen doesn't get dimmed/locked away mid-rest if the app is left
  foregrounded on the counter. Small addition, `navigator.wakeLock`, widely
  supported including iOS Safari 16.4+.

Both are additive on top of the core rest timer from §5, gated behind
feature detection so the app degrades fine on browsers without them.

## 10. Suggested build order

Rough milestones, each independently useful/demoable:

1. **Model** (`model.js`): shapes from §3, `flattenLeaves`, `isNodeComplete`,
   `applyDoubleProgression`, `nextWorkout`/`advanceCycle`. No UI yet —
   sanity-check by hand in the console.
2. **Storage** (`storage.js`): load/save to `localStorage`, JSON export/
   import. Wire model + storage together with no view: confirm a plan
   round-trips through save/reload.
3. **Plan/Workout editors**: the only way to get a real plan in without
   hand-editing `localStorage` — needed before the session flow is testable
   end-to-end.
4. **Home + Active Session + rest timer**: the core loop (§5, §6.1–6.3).
5. **History**: stat row + calendar (`common/heatmap.js`, near-zero new
   code) + Sessions table first — that's most of the value. Progress graph
   (`chart.js`) as the last piece of this milestone, since it needs several
   real logged sessions to be worth looking at anyway.
6. **Export CSV, Settings page.**
7. **PWA shell** (manifest + service worker) — do this last, once the app
   shape is stable, so the cached-files list in the service worker isn't
   being rewritten every session.
8. **Notification-on-rest-end / wake lock** (§9) — genuine stretch, last.

## 11. Open questions / assumptions to confirm before or during build

- **Units**: proposing a single global kg/lb setting (in `settings`) rather
  than per-exercise units, since mixing units within one plan seems more
  confusing than useful. Flag if per-exercise units are actually wanted.
- **Multiple plans active at once?** Modeled as many `WorkoutPlan`s existing,
  but only one `activePlanId` "in rotation" at a time (Home only ever shows
  one plan's next workout). Switching plans doesn't touch the other plan's
  own `cursor`, so pausing plan A to run plan B and coming back to A resumes
  where it left off.
- **Deleting a plan/workout/exercise that has history** — resolved by the
  stored-entry shape in §5: each finished session snapshots the exercise
  `name` at log time rather than doing a live lookup by id, so History
  (§6.1) — including the per-exercise Progress graph — keeps reading
  correctly regardless of later plan edits or deletions.
- **Bodyweight exercises** (no external weight) — not called out in the
  original feature list. Proposing `weight: 0` handles it without a special
  case (progression would need reps-only handling, or just leave weight
  progression off for those nodes) — flag if bodyweight tracking needs to be
  a first-class thing.
