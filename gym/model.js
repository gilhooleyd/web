/**
 * Pure data model + helpers for the gym tracker.
 * No Mithril here — this file only builds/reads plain data.
 * See gym/plan.md for the full design writeup.
 */

function genId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function round(n) {
  return Math.round(n * 100) / 100;
}

// "YYYY-MM-DD" for the LOCAL calendar day — never `date.toISOString().slice(0,10)`,
// which reads the UTC day and silently shifts evening workouts to the wrong
// date for anyone west of UTC.
function localDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Parse a "YYYY-MM-DD" string as a local date (not UTC midnight, which is
// what `new Date("YYYY-MM-DD")` gives you and which round-trips to the
// wrong day once you read local getters back off it).
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------
// Plan / Workout / ExerciseNode construction
// ---------------------------------------------------------------------

function newExercise({
  name = 'New Exercise',
  sets = 3,
  repRange = { min: 8, max: 12 },
  weight = 0,
  unit = 'lb',
  restSeconds = 90,
  increment = 2.5,
} = {}) {
  return {
    id: genId('node'),
    kind: 'exercise',
    name,
    sets,
    repRange: { min: repRange.min, max: repRange.max },
    weight,
    unit,
    restSeconds,
    progression: { type: 'double-progression', increment },
    children: null,
  };
}

function newGroup({ name = 'New Group', sets = 3, restSeconds = 60, children = [] } = {}) {
  return {
    id: genId('node'),
    kind: 'group',
    name,
    sets,
    repRange: null,
    weight: null,
    unit: null,
    restSeconds,
    progression: null,
    children,
  };
}

function newWorkout(name = 'New Workout') {
  return { id: genId('workout'), name, nodes: [] };
}

function newPlan(name = 'New Plan') {
  return { id: genId('plan'), name, workouts: [], cycle: [], cursor: 0 };
}

// ---------------------------------------------------------------------
// Default starter plan — seeded once on first run when there are no
// plans yet (see App.oninit in script.js). A simple A/B compound split:
// lower rep range (8-10) on the compound lifts, higher (10-12) on curls.
// Starting weights are deliberately light — just the bar for barbell
// lifts, a light dumbbell for the rest — so double progression has room
// to run for months rather than stalling week one.
// ---------------------------------------------------------------------

function defaultPlan() {
  const plan = newPlan('Compound Split');

  const workoutA = newWorkout('A');
  workoutA.nodes.push(
    newExercise({ name: 'Bench Press', weight: 45, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 120, increment: 5 }),
    newExercise({ name: 'One-Arm Row', weight: 25, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Deadlift', weight: 95, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 150, increment: 10 }),
    newExercise({ name: 'Curls', weight: 15, unit: 'lb', repRange: { min: 10, max: 12 }, restSeconds: 60, increment: 5 }),
  );

  // Lat Pulldown added so B day has a pulling movement too — as built,
  // A+B only had one pull (One-Arm Row) against two pushes (Bench,
  // Shoulder Press), which skews push-heavy over a full cycle.
  const workoutB = newWorkout('B');
  workoutB.nodes.push(
    newExercise({ name: 'Squats', weight: 45, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 120, increment: 5 }),
    newExercise({ name: 'Lat Pulldown', weight: 40, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Shoulder Press', weight: 45, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Curls', weight: 15, unit: 'lb', repRange: { min: 10, max: 12 }, restSeconds: 60, increment: 5 }),
  );

  plan.workouts.push(workoutA, workoutB);
  plan.cycle.push(workoutA.id, workoutB.id);

  return plan;
}

// A second starter plan, seeded alongside defaultPlan() purely so a
// fresh install has more than one plan to look at in the Plans list —
// it isn't made active and doesn't get demo history (see
// seedDemoSessions below, which only runs against the active plan).
function pushPullPlan() {
  const plan = newPlan('Push/Pull Split');

  const push = newWorkout('Push');
  push.nodes.push(
    newExercise({ name: 'Bench Press', weight: 45, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 120, increment: 5 }),
    newExercise({ name: 'Overhead Press', weight: 45, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 120, increment: 5 }),
    newExercise({ name: 'Incline Dumbbell Press', weight: 20, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Triceps Pushdown', weight: 20, unit: 'lb', repRange: { min: 10, max: 12 }, restSeconds: 60, increment: 5 }),
  );

  const pull = newWorkout('Pull');
  pull.nodes.push(
    newExercise({ name: 'Deadlift', weight: 95, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 150, increment: 10 }),
    newExercise({ name: 'Lat Pulldown', weight: 40, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Seated Row', weight: 40, unit: 'lb', repRange: { min: 8, max: 10 }, restSeconds: 90, increment: 5 }),
    newExercise({ name: 'Bicep Curl', weight: 15, unit: 'lb', repRange: { min: 10, max: 12 }, restSeconds: 60, increment: 5 }),
  );

  plan.workouts.push(push, pull);
  plan.cycle.push(push.id, pull.id);

  return plan;
}

// ---------------------------------------------------------------------
// Demo history — simulates `sessionCount` past workouts against `plan`
// so a fresh install has something in History to look at (calendar,
// stats, table, progress graph) instead of an empty state. Drives the
// REAL logSet/finishSession logic rather than hand-authoring session
// records, so double progression actually runs: reps climb toward the
// top of each exercise's rep range session over session, and once a
// session tops out, finishSession bumps the real plan weight and this
// resets back to chasing the bottom of the range again — the same
// sawtooth double progression produces for a real lifter.
// Mutates `plan` in place (weights end up wherever progression took
// them) and returns the finished sessions, oldest first.
// ---------------------------------------------------------------------

function seedDemoSessions(plan, sessionCount = 12) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const today = new Date();
  const repTarget = {}; // leaf path -> reps currently being attempted

  const sessions = [];
  for (let i = 0; i < sessionCount; i++) {
    const workout = nextWorkout(plan);
    if (!workout) break;

    const daysAgo = 2 + (sessionCount - 1 - i) * 2.5;
    const date = new Date(today.getTime() - daysAgo * msPerDay);

    const session = newSession(plan, workout);
    session.date = localDateStr(date);
    session.startedAt = date.toISOString();

    const leaves = flattenLeaves(workout.nodes);
    leaves.forEach((leaf) => {
      if (repTarget[leaf.path] === undefined) repTarget[leaf.path] = leaf.repRange.min;
      const reps = repTarget[leaf.path];
      for (let s = 0; s < leaf.sets; s++) logSet(session, leaf.path, reps, leaf.weight);
    });

    const results = finishSession(plan, workout, session);
    session.finishedAt = date.toISOString(); // finishSession stamps "now" — back-date it to fit the simulated history

    // Real usage leaves 'increase' as a proposal for the finish screen's
    // Accept button — there's no one to click it here, so the simulation
    // accepts every increase immediately to keep the demo weights climbing.
    results.forEach((r) => { if (r.change === 'increase') acceptProgressionIncrease(workout, r.nodeId, r.to); });

    const increasedNames = new Set(results.filter((r) => r.change === 'increase').map((r) => r.name));
    leaves.forEach((leaf) => {
      repTarget[leaf.path] = increasedNames.has(leaf.name)
        ? leaf.repRange.min
        : Math.min(leaf.repRange.max, repTarget[leaf.path] + 1);
    });

    sessions.push(session);
  }

  return sessions;
}

// ---------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------

// Walk a list of nodes, returning every leaf exercise in order, each
// annotated with its dotted path (for looking up logged sets).
function flattenLeaves(nodes, pathPrefix = '') {
  const leaves = [];
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.id}` : node.id;
    if (node.kind === 'group') {
      leaves.push(...flattenLeaves(node.children, path));
    } else {
      leaves.push({ ...node, path });
    }
  }
  return leaves;
}

function findNodeByPath(nodes, path) {
  const [headId, ...rest] = path.split('.');
  const node = nodes.find((n) => n.id === headId);
  if (!node) return null;
  if (rest.length === 0) return node;
  return findNodeByPath(node.children || [], rest.join('.'));
}

// Move the item at `index` by `delta` positions (e.g. -1 = up, +1 = down).
// Returns a new array; no-op (same array) if the move would go out of bounds.
function moveItem(arr, index, delta) {
  const newIndex = index + delta;
  if (newIndex < 0 || newIndex >= arr.length) return arr;
  const copy = arr.slice();
  const [item] = copy.splice(index, 1);
  copy.splice(newIndex, 0, item);
  return copy;
}

// ---------------------------------------------------------------------
// Workout cycle
// ---------------------------------------------------------------------

function nextWorkout(plan) {
  if (!plan || !plan.cycle.length) return null;
  const workoutId = plan.cycle[plan.cursor % plan.cycle.length];
  return plan.workouts.find((w) => w.id === workoutId) || null;
}

function advanceCycle(plan) {
  if (!plan.cycle.length) return plan.cursor;
  return (plan.cursor + 1) % plan.cycle.length;
}

// ---------------------------------------------------------------------
// Live session (in-progress workout)
// ---------------------------------------------------------------------

function newSession(plan, workout) {
  const now = new Date();
  return {
    id: genId('session'),
    planId: plan.id,
    workoutId: workout.id,
    date: localDateStr(now),
    startedAt: now.toISOString(),
    finishedAt: null,
    entries: {}, // live shape: path -> [{ reps, weight }]
    extraSets: {}, // leaf path -> count of sets added on top of the plan during this session
  };
}

function loggedSetsFor(session, path) {
  return session.entries[path] || [];
}

function logSet(session, path, reps, weight) {
  const sets = session.entries[path] || (session.entries[path] = []);
  sets.push({ reps, weight });
}

function undoLastSet(session, path) {
  const sets = session.entries[path];
  if (sets && sets.length) sets.pop();
}

// Rounds completed for a group node: the minimum number of sets logged
// across its children's leaf paths (a round isn't "done" until every
// child in it has been logged once).
function groupRoundsCompleted(childPaths, session) {
  if (!childPaths.length) return 0;
  return Math.min(...childPaths.map((p) => loggedSetsFor(session, p).length));
}

// Logs a set for one child of a superset/group and reports whether that
// set just completed a full round (every child now has one more set
// logged than before) — the controller uses `roundCompleted` to decide
// whether to start the group's between-round rest timer, without having
// to reconstruct the before/after round count itself.
function logGroupSet(session, groupNode, groupPath, leafPath, reps, weight) {
  const childPaths = flattenLeaves(groupNode.children, groupPath).map((c) => c.path);
  const before = groupRoundsCompleted(childPaths, session);
  logSet(session, leafPath, reps, weight);
  const after = groupRoundsCompleted(childPaths, session);
  return { roundCompleted: after > before };
}

// ---------------------------------------------------------------------
// Double progression
// ---------------------------------------------------------------------

// (exerciseNode, loggedSets: {reps, weight}[]) -> { nextWeight, change }
// change is 'increase' | 'decrease' | 'none'.
//
// Progression is based on the weight you actually logged, not the plan's
// stored baseline — the log-set stepper defaults to that baseline but you
// can dial it up or down live, and once a session validates the new
// weight (didn't miss the bottom of the rep range), that becomes the new
// baseline rather than the plan silently reverting to its old value next
// time (e.g. you bump the weight up and just barely hit the minimum reps
// — that's real progress, not a no-op).
//   - Every set at or above the top of the rep range: topped out, go up.
//   - Any set below the BOTTOM of the rep range: missed the floor, go back
//     down (same step size as the increase) — you took too much weight.
//   - Otherwise still within the rep range: adopt whatever weight was
//     actually logged, if it differs from the plan's baseline.
function applyDoubleProgression(node, loggedSets) {
  if (!node.progression || node.progression.type !== 'double-progression' || !loggedSets.length) {
    return { nextWeight: node.weight, change: 'none' };
  }
  const actualWeight = loggedSets[loggedSets.length - 1].weight;
  if (loggedSets.every((s) => s.reps >= node.repRange.max)) {
    return { nextWeight: round(actualWeight + node.progression.increment), change: 'increase' };
  }
  if (loggedSets.some((s) => s.reps < node.repRange.min)) {
    return { nextWeight: Math.max(0, round(actualWeight - node.progression.increment)), change: 'decrease' };
  }
  if (actualWeight !== node.weight) {
    return { nextWeight: actualWeight, change: actualWeight > node.weight ? 'increase' : 'decrease' };
  }
  return { nextWeight: node.weight, change: 'none' };
}

// Applies one accepted increase to the real plan node — 'increase'
// results are proposals from finishSession (see below), not applied
// automatically; the finish-summary screen calls this per exercise (or
// for all of them via "Accept All"). 'decrease' results, by contrast,
// are applied immediately by finishSession itself — see its comment.
function acceptProgressionIncrease(workout, nodeId, nextWeight) {
  const node = findNodeByPath(workout.nodes, nodeId);
  if (node) node.weight = nextWeight;
}

// ---------------------------------------------------------------------
// Finishing a session: live entries -> stored entries, apply progression,
// mutate the plan's node weights, advance the cycle.
// Mutates `session` and `plan` (cursor) in place. A 'decrease' is applied
// to the real node immediately — missing the bottom of the rep range
// means the weight was too heavy, so there's nothing to confirm. An
// 'increase' is NOT applied here: it's a proposal the finish-summary
// screen shows with an Accept button (see acceptProgressionIncrease) —
// you might want to stay at a weight longer even after topping out.
// Each stored entry carries its own `change`/`weightFrom`/`weightTo` (so
// History can show the same indicator later, not just right after
// logging it) — also returned as a flat `results` list
// ({ nodeId, name, from, to, unit, change }) for the finish summary, one
// per worked exercise, not just the ones that changed.
// ---------------------------------------------------------------------

function finishSession(plan, workout, session) {
  const leaves = flattenLeaves(workout.nodes);
  const storedEntries = [];
  const results = [];

  for (const leaf of leaves) {
    const sets = session.entries[leaf.path];
    if (!sets || !sets.length) continue;

    const { nextWeight, change } = applyDoubleProgression(leaf, sets);
    if (change === 'decrease') {
      const realNode = findNodeByPath(workout.nodes, leaf.path);
      if (realNode) realNode.weight = nextWeight;
    }

    storedEntries.push({
      nodeId: leaf.path,
      name: leaf.name,
      unit: leaf.unit,
      repRange: leaf.repRange,
      sets: sets.slice(),
      change,
      weightFrom: leaf.weight,
      weightTo: nextWeight,
    });
    results.push({ nodeId: leaf.path, name: leaf.name, from: leaf.weight, to: nextWeight, unit: leaf.unit, change });
  }

  session.entries = storedEntries;
  session.finishedAt = new Date().toISOString();
  plan.cursor = advanceCycle(plan);

  return results;
}

// ---------------------------------------------------------------------
// History / stats (operate on finished sessions, stored-entry shape)
// ---------------------------------------------------------------------

function totalSessions(sessions) {
  return sessions.filter((s) => s.finishedAt).length;
}

function entryVolume(entry) {
  return entry.sets.reduce((sum, set) => sum + set.weight * set.reps, 0);
}

function sessionVolume(session) {
  return session.entries.reduce((sum, entry) => sum + entryVolume(entry), 0);
}

function totalWeightLifted(sessions) {
  return sessions.filter((s) => s.finishedAt).reduce((sum, s) => sum + sessionVolume(s), 0);
}

function distinctExerciseNames(sessions) {
  const names = new Set();
  sessions.forEach((s) => (s.entries || []).forEach((e) => names.add(e.name)));
  return [...names].sort();
}

// -> [{ date, volume, unit }], one point per session that logged this
// exercise, oldest first.
function exerciseSeries(sessions, name) {
  return sessions
    .filter((s) => s.finishedAt)
    .map((s) => {
      const entry = (s.entries || []).find((e) => e.name === name);
      return entry ? { date: s.date, volume: entryVolume(entry), unit: entry.unit } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The last set of the most recent session that logged this exercise (by
// name, same identity rule as exerciseSeries) — shown on the exercise
// card while logging today, as a "here's what you did last time"
// reference. null if it's never been logged before.
function lastLoggedSet(sessions, name) {
  const finished = sessions.filter((s) => s.finishedAt).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  for (const s of finished) {
    const entry = (s.entries || []).find((e) => e.name === name);
    if (entry && entry.sets.length) return entry.sets[entry.sets.length - 1];
  }
  return null;
}

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

// Comma-grouped, not abbreviated — "7,420", never "7.4k".
function formatVolume(n) {
  return round(n).toLocaleString();
}

// Milliseconds -> "42 min" or "1h 12m" for the finish-summary "time spent" stat.
function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

// Shared by the finish-summary exercise list and History's expanded
// session detail, so both read the same way. `to` may be missing on
// sessions logged before `change`/weight-from/weight-to existed in the
// stored-entry shape — degrades to no detail text rather than "undefined".
// (The icon itself is a view concern — see changeIcon() in script.js.)
function progressionChangeDetail(change, from, to, unit) {
  if (to == null) return null;
  return change === 'none' ? `${to}${unit}` : `${from}${unit} → ${to}${unit}`;
}
