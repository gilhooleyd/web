/**
 * Mithril views + App state/glue. Model logic lives in model.js,
 * persistence in storage.js, chart rendering in chart.js — this file
 * is the "controller + view" layer that wires them together.
 *
 * A note on hyperscript arrays and `key`: the vendored `h()` helper in
 * libs/mithril.js walks a `[selector, attrs, children]` array recursively.
 * A single vnode array (e.g. ['span.foo', 'text'] or the result of a call
 * like trashIcon()) must never be used as the bare/unwrapped children
 * value of another node — child() will reduce over ITS OWN parts instead
 * of treating it as one child; wrap it in an array (`[trashIcon()]`)
 * first. And Mithril itself requires that within any one children array,
 * vnodes are either ALL keyed or ALL unkeyed (a plain string or `null`
 * counts as unkeyed) — including nulls hiding inside an array that gets
 * spread into a parent (e.g. a `.map()` result containing some `null`
 * entries, used as one of several siblings). The pattern used throughout
 * below: only `.map()` output over a genuine dynamic list gets `key`s,
 * and whenever such a list shares a children array with other static
 * siblings, the list is wrapped in its own dedicated container so the
 * keying (and any nulls) stay self-contained.
 */

const WEEKDAY_ABBR = ['Su', 'M', 'T', 'W', 'Th', 'F', 'Sa'];

// ---------------------------------------------------------------------
// Small view-only helpers
// ---------------------------------------------------------------------

function targetRepGuess(node) {
  return Math.round((node.repRange.min + node.repRange.max) / 2);
}

function weightStep(unit) {
  return unit === 'kg' ? 2.5 : 5;
}

function formatRestTime(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Like formatRestTime but with hours, for the bottom bar's live workout
// clock — a rest period is always under an hour, a workout isn't always.
function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? m.toString().padStart(2, '0') : m;
  return h > 0 ? `${h}:${mm}:${sec.toString().padStart(2, '0')}` : `${mm}:${sec.toString().padStart(2, '0')}`;
}

function shortMonthDay(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
}

function weekdayAbbr(dateStr) {
  return WEEKDAY_ABBR[parseLocalDate(dateStr).getDay()];
}

// "today" / "yesterday" / "N days ago" for a stored "YYYY-MM-DD" date,
// counting whole LOCAL calendar days (not 24h spans) so a workout logged
// late last night still reads "yesterday" this morning. Lowercase so it
// drops into "Last done ___" on the home screen.
function relativeDayLabel(dateStr) {
  const then = parseLocalDate(dateStr);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startOfToday - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Parse a numeric field's raw string value, clamped to `min`.
// Empty / non-numeric -> `min`.
function clampNumber(raw, min = 0) {
  const n = parseFloat(raw);
  return Number.isNaN(n) ? min : Math.max(min, round(n));
}

// The oninput/onblur pair shared by every editable numeric field (the
// steppers below and the editor's numberInput). While the field is being
// edited we let it go transiently empty — deleting the last digit — by
// skipping the redraw (so Mithril doesn't immediately repaint `min` over
// what was typed) and leaving the model untouched until blur, which
// clamps. Without this you can never clear a field to retype it.
function numericFieldHandlers(onChange, min) {
  return {
    // Tap/focus selects the whole value so the next keystroke replaces it
    // wholesale — the common "set it to a specific number" gesture.
    onfocus: (e) => e.target.select(),
    oninput: (e) => {
      if (e.target.value === '') { e.redraw = false; return; }
      onChange(clampNumber(e.target.value, min));
    },
    onblur: (e) => {
      if (e.target.value === '' || Number.isNaN(parseFloat(e.target.value))) onChange(min);
    },
  };
}

// Live logging stepper: −/＋ buttons around an editable number. The value
// is a real <input> (not a span) so tapping it on a phone brings up the
// numeric keyboard and it can be typed directly on a laptop.
function stepperControl(value, onChange, { min = 0, step = 1 } = {}) {
  return ['div.stepper', [
    ['button.stepper-btn', { type: 'button', onclick: () => onChange(Math.max(min, round(value - step))) }, '−'],
    ['input.stepper-value', {
      type: 'number', inputmode: 'decimal', min, step, value: round(value),
      ...numericFieldHandlers(onChange, min),
    }],
    ['button.stepper-btn', { type: 'button', onclick: () => onChange(round(value + step)) }, '+'],
  ]];
}

// A single clamped <input type="number">, for editor forms (not the live
// logging steppers above — those are stepperControl).
function numberInput(value, onChange, { min = 0, step = 1 } = {}) {
  return ['input', {
    type: 'number', min, step, value,
    ...numericFieldHandlers(onChange, min),
  }];
}

// A numberInput with its usual "label.field" wrapper, for the common case
// of one label + one number field (a rep range or a weight+unit pair
// still needs its own bespoke layout — see exerciseFieldsEditor).
function numberField(label, value, onChange, opts) {
  return ['label.field', [label, numberInput(value, onChange, opts)]];
}

// A hand-drawn trash-can icon (no icon font/library) for delete buttons.
// Always wrap the call site's usage in an array — see the note at the
// top of this file.
function trashIcon() {
  return ['svg.icon-trash', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }, [
    ['path', { d: 'M4 7h16' }],
    ['path', { d: 'M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3' }],
    ['path', { d: 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13' }],
    ['path', { d: 'M10 11v6' }],
    ['path', { d: 'M14 11v6' }],
  ]];
}

// A simple hand-drawn gear/settings icon for "edit this plan" links.
// Same wrap-in-an-array rule as trashIcon() applies at call sites.
function cogIcon() {
  return ['svg.icon-cog', {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }, [
    ['circle', { cx: 12, cy: 12, r: 7 }],
    ['circle', { cx: 12, cy: 12, r: 2.5 }],
    ['line', { x1: 19.5, y1: 12, x2: 21.5, y2: 12 }],
    ['line', { x1: 17.3, y1: 17.3, x2: 18.7, y2: 18.7 }],
    ['line', { x1: 12, y1: 19.5, x2: 12, y2: 21.5 }],
    ['line', { x1: 6.7, y1: 17.3, x2: 5.3, y2: 18.7 }],
    ['line', { x1: 4.5, y1: 12, x2: 2.5, y2: 12 }],
    ['line', { x1: 6.7, y1: 6.7, x2: 5.3, y2: 5.3 }],
    ['line', { x1: 12, y1: 4.5, x2: 12, y2: 2.5 }],
    ['line', { x1: 17.3, y1: 6.7, x2: 18.7, y2: 5.3 }],
  ]];
}

// Green up / red down, not emoji (color-emoji glyphs like 🔺 render as a
// fixed color no matter what — plain triangle characters respect CSS
// `color`, so "increase" reads as unambiguously good and "decrease" as
// unambiguously bad rather than both being the same red).
function changeIcon(change) {
  if (change === 'increase') return ['span.change-icon.change-up', '▲'];
  if (change === 'decrease') return ['span.change-icon.change-down', '▼'];
  return ['span.change-icon.change-none', '▪'];
}

// Per-exercise draft (weight/reps currently dialed in for the next set),
// lazily created from the exercise's target the first time it's touched.
function getDraft(node, path) {
  if (!App.logDraft[path]) {
    App.logDraft[path] = { weight: node.weight, reps: targetRepGuess(node) };
  }
  return App.logDraft[path];
}

// ---------------------------------------------------------------------
// Active session: exercise cards (always expanded, sets lined up),
// group blocks, floating rest banner
// ---------------------------------------------------------------------

// One row per planned set: logged sets show what was done, the next set
// up is editable, sets further out show a muted preview of the target.
// Rendering all `totalSets` rows up front (rather than only the logged
// ones) keeps the card a fixed height so nothing shifts as you log.
// `totalSets` defaults to the node's own `sets`, but a group child passes
// its group's round count instead — a group's `sets` is the number of
// rounds through its children, not a per-child count (see model.js).
// Once every planned set is logged, a light-green "Add Set" button
// appears in place of the next row; tapping it extends `totalSets` for
// just today (session.extraSets, not the plan template), which brings
// back a normal editable set-row to log into.
function exerciseCard(node, path, onLog, baseTotalSets = node.sets) {
  const totalSets = baseTotalSets + (App.session.extraSets[path] || 0);
  const logged = loggedSetsFor(App.session, path);
  const done = logged.length >= totalSets;
  const draft = getDraft(node, path);
  const lastSet = lastLoggedSet(App.sessions, node.name);

  const rows = [];
  for (let i = 0; i < totalSets; i++) {
    if (i < logged.length) {
      const isLast = i === logged.length - 1;
      rows.push(['div.set-row.set-done', {
        key: `s${i}`,
        class: isLast ? 'undoable' : '',
        onclick: isLast ? () => { undoLastSet(App.session, path); App.saveActiveSession(); } : undefined,
      }, [
        ['span.set-index', `${i + 1}`],
        ['span.set-value', node.bodyweight ? `${logged[i].reps} reps` : `${logged[i].weight}${node.unit} × ${logged[i].reps}`],
        isLast ? ['span.set-undo', '↺'] : null,
      ]]);
    } else if (i === logged.length) {
      rows.push(['div.set-row.set-active', { key: `s${i}` }, [
        ['span.set-index', `${i + 1}`],
        node.bodyweight ? null : stepperControl(draft.weight, (v) => { draft.weight = v; }, { min: 0, step: weightStep(node.unit) }),
        stepperControl(draft.reps, (v) => { draft.reps = v; }, { min: 0, step: 1 }),
        ['button.btn-success.set-log-btn', { onclick: () => onLog(draft) }, 'Log'],
      ]]);
    } else {
      rows.push(['div.set-row.set-future', { key: `s${i}` }, [
        ['span.set-index', `${i + 1}`],
        ['span.set-target', node.bodyweight
          ? `${node.repRange.min}-${node.repRange.max} reps`
          : `${node.weight}${node.unit} × ${node.repRange.min}-${node.repRange.max}`],
      ]]);
    }
  }
  // Every planned set is done. Rather than an extra pre-filled logging row,
  // show a light-green "Add Set" button: tapping it just adds one more
  // loggable set for today (session.extraSets), which makes `done` false so
  // the normal editable set-row below takes its place — the button
  // reappears once that set is logged.
  if (done) {
    rows.push(['button.btn-add-set', { key: 'extra', onclick: () => App.addExtraSet(path) }, '+ Add Set']);
  }

  return ['div.card.exercise-card', { key: path, class: done ? 'done' : '' }, [
    ['div.exercise-card-header', [
      ['span.exercise-name', node.name],
      ['span.exercise-target', `${node.repRange.min}-${node.repRange.max} reps`],
    ]],
    lastSet ? ['p.exercise-last', node.bodyweight ? `Last: ${lastSet.reps} reps` : `Last: ${lastSet.weight}${node.unit} × ${lastSet.reps}`] : null,
    ['div.set-rows', rows],
  ]];
}

function groupBlock(node, groupPath) {
  const childLeaves = flattenLeaves(node.children, groupPath);
  const roundsDone = groupRoundsCompleted(childLeaves.map((c) => c.path), App.session);
  return ['div.card.group-block', { key: groupPath }, [
    ['div.group-header', [
      ['span.row-name', node.name],
      ['span.row-progress', `Round ${Math.min(roundsDone + 1, node.sets)} of ${node.sets}`],
    ]],
    ['div.group-children', childLeaves.map((leaf) => exerciseCard(
      leaf,
      leaf.path,
      (draft) => App.logGroupSet(node, groupPath, leaf.path, draft),
      node.sets,
    ))],
  ]];
}

function sessionNodesView(workout) {
  return workout.nodes.map((node) => {
    const path = node.id;
    if (node.kind === 'group') return groupBlock(node, path);
    return exerciseCard(node, path, (draft) => App.logLeafSet(node, path, draft));
  });
}

// Seconds remaining, computed from the stored end timestamp rather than
// ticked down — see App.startRest for why (setInterval gets throttled or
// fully suspended in a backgrounded/locked-screen tab, so a counter that
// only decrements on tick effectively pauses; a timestamp-based countdown
// always reflects real elapsed time the moment anything re-renders it,
// catching up instantly instead of staying frozen).
function restSecondsLeft() {
  if (App.rest.endsAt == null) return 0;
  return Math.max(0, Math.ceil((App.rest.endsAt - Date.now()) / 1000));
}

// Fixed-position, so it floats above the exercise list regardless of
// scroll position, and appearing/disappearing never shifts that list
// (it isn't part of the normal document flow either way).
function restFloat() {
  if (App.rest.endsAt == null) return null;
  return ['div.rest-float', [
    ['span.rest-label', 'Resting'],
    ['span.rest-time', formatRestTime(restSecondsLeft())],
    ['div.rest-actions', [
      ['button', { onclick: () => { App.rest.endsAt += 15000; } }, '+15s'],
      ['button', { onclick: () => App.stopRest() }, 'Skip'],
    ]],
  ]];
}

// ---------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------

// One plan on the home screen: name + edit gear, when it was last done,
// and a tappable row per workout. Each row leads with a blue "Next" badge
// on the workout the plan's cycle points at; the other rows render the
// same badge but hidden, so every day name lines up in one column. Every
// day is startable, not just the "Next" one.
function planCard(plan) {
  const nextId = (nextWorkout(plan) || {}).id;
  const lastDate = lastPlanSessionDate(App.sessions, plan.id);
  return ['div.card.plan-card', { key: plan.id }, [
    ['div.plan-card-header', [
      ['span.plan-card-name', plan.name],
      ['button.icon-btn', {
        onclick: () => { App.editingPlanId = plan.id; App.page = 'planEditor'; },
      }, [cogIcon()]],
    ]],
    ['p.plan-card-sub', lastDate ? `Last done ${relativeDayLabel(lastDate)}` : 'Not done yet'],
    plan.workouts.length
      ? ['div.day-rows', plan.workouts.map((w) => ['button.day-row', {
        key: w.id,
        onclick: () => App.startSession(plan, w),
      }, [
        ['span.badge.badge-next', { class: w.id === nextId ? '' : 'badge-hidden' }, 'Next'],
        ['span.day-row-name', w.name],
      ]])]
      : ['p.plan-card-empty', 'No days yet — tap the gear to add one'],
  ]];
}

function homeView() {
  return ['div.container', [
    ['section', [
      ['h2', 'Plans'],
      App.plans.length === 0
        ? ['p.empty-hint', 'No plans yet.']
        : ['div.plan-list', App.plans.map((p) => planCard(p))],
      ['button.btn-secondary', { onclick: () => App.createPlan() }, '+ New Plan'],
    ]],
  ]];
}

function activeSessionView() {
  const workout = App.currentWorkout();
  return ['div.container.session-page', [
    restFloat(),
    ['div.exercise-list', sessionNodesView(workout)],
    ['button.btn-secondary', { onclick: () => App.addAdHocExercise() }, '+ Add Exercise'],
  ]];
}

// Both a proposed 'increase' and a proposed 'decrease' need an explicit
// Accept (see model.js's finishSession/acceptProgressionChange); 'none'
// needs no action, so it shows no button.
function isProposal(r) {
  return r.change === 'increase' || r.change === 'decrease';
}

function summaryExerciseRow(r) {
  return ['div.row.summary-exercise-row', { key: r.name }, [
    changeIcon(r.change),
    ['span.summary-exercise-name', r.name],
    ['span.summary-exercise-detail', progressionChangeDetail(r.change, r.from, r.to, r.unit)],
    isProposal(r) ? (r.accepted
      ? ['span.summary-accepted', '✓']
      : ['button.btn-success.btn-small', { onclick: () => App.acceptChange(r) }, 'Accept']) : null,
  ]];
}

function sessionSummaryView() {
  const summary = App.finishSummary;
  if (!summary) return null;
  const pending = summary.results.filter((r) => isProposal(r) && !r.accepted);
  return ['div.container', [
    ['section', [
      ['h2', `Workout ${summary.workoutName} complete`],
      ['div.stat-row', [
        ['div.stat-tile', [['span.stat-value', formatDuration(summary.durationMs)], ['span.stat-label', 'Time Spent']]],
        ['div.stat-tile', [['span.stat-value', summary.setCount.toString()], ['span.stat-label', 'Sets Logged']]],
        ['div.stat-tile', [
          ['span.stat-value', `${formatVolume(summary.totalVolume)} ${summary.unit}`],
          ['span.stat-label', 'Weight Lifted'],
        ]],
      ]],
      ['h3', 'Exercises'],
      ['div.summary-exercise-list', summary.results.map((r) => summaryExerciseRow(r))],
      ['div.summary-actions', [
        pending.length
          ? ['button.btn-secondary', { onclick: () => App.acceptAllChanges() }, 'Accept All']
          : null,
        ['button.btn-success', { onclick: () => { App.finishSummary = null; App.page = 'home'; } }, 'Done'],
      ]],
    ]],
  ]];
}

// Toggling bodyweight on/off nulls or restores weight/unit/progression
// together, the same shape newExercise({bodyweight}) produces — there's
// nothing for double progression to act on without a weight to track.
function setBodyweight(node, bodyweight, save) {
  node.bodyweight = bodyweight;
  node.weight = bodyweight ? null : 0;
  node.unit = bodyweight ? null : App.settings.unit;
  node.progression = bodyweight ? null : { type: 'double-progression', increment: 2.5 };
  save();
}

function exerciseFieldsEditor(node, save) {
  return ['div.node-fields', [
    numberField('Sets', node.sets, (v) => { node.sets = v; save(); }, { min: 1 }),
    ['label.field', ['Reps', ['div.rep-range', [
      numberInput(node.repRange.min, (v) => { node.repRange.min = v; save(); }, { min: 1 }),
      ['span', '–'],
      numberInput(node.repRange.max, (v) => { node.repRange.max = v; save(); }, { min: 1 }),
    ]]]],
    ['label.field.field-checkbox', [
      ['input', {
        type: 'checkbox',
        checked: node.bodyweight,
        onchange: (e) => setBodyweight(node, e.target.checked, save),
      }],
      'Bodyweight',
    ]],
    node.bodyweight ? null : ['label.field', ['Weight', ['div.weight-unit', [
      numberInput(node.weight, (v) => { node.weight = v; save(); }, { min: 0, step: 0.5 }),
      ['select', { value: node.unit, onchange: (e) => { node.unit = e.target.value; save(); } }, [
        ['option', { value: 'lb' }, 'lb'],
        ['option', { value: 'kg' }, 'kg'],
      ]],
    ]]]],
    numberField('Rest (sec)', node.restSeconds, (v) => { node.restSeconds = v; save(); }, { min: 0, step: 5 }),
    node.bodyweight ? null : numberField('+/− weight on progression', node.progression.increment, (v) => { node.progression.increment = v; save(); }, { min: 0, step: 0.5 }),
  ]];
}

function nodeRowEditor(list, index, save) {
  const node = list[index];
  const isGroup = node.kind === 'group';
  return ['div.card.node-editor', { key: node.id }, [
    ['div.node-editor-header', [
      ['input.node-name', { type: 'text', value: node.name, oninput: (e) => { node.name = e.target.value; save(); } }],
      ['div.node-editor-actions', [
        ['button.btn-secondary', {
          title: 'Move up',
          onclick: () => { list.splice(0, list.length, ...moveItem(list, index, -1)); save(); },
        }, '↑'],
        ['button.btn-secondary', {
          title: 'Move down',
          onclick: () => { list.splice(0, list.length, ...moveItem(list, index, 1)); save(); },
        }, '↓'],
        ['button.btn-danger', {
          onclick: () => { if (confirm(`Delete "${node.name}"?`)) { list.splice(index, 1); save(); } },
        }, [trashIcon()]],
      ]],
    ]],
    isGroup ? ['div.node-fields', [
      numberField('Rounds', node.sets, (v) => { node.sets = v; save(); }, { min: 1 }),
      numberField('Rest between rounds (sec)', node.restSeconds, (v) => { node.restSeconds = v; save(); }, { min: 0, step: 5 }),
    ]] : exerciseFieldsEditor(node, save),
    isGroup ? ['div.group-children-editor', [
      ['div.group-children-editor-list', node.children.map((child, i) => nodeRowEditor(node.children, i, save))],
      ['button.btn-secondary', {
        onclick: () => { node.children.push(newExercise({ unit: App.settings.unit })); save(); },
      }, '+ Add Exercise to Group'],
    ]] : null,
  ]];
}

// A whole workout — name, its full exercise list, inline — shown directly
// on the Plan Editor page rather than behind a separate "Edit" screen.
function workoutEditorSection(plan, workout, save) {
  return ['section.workout-editor-section', { key: workout.id }, [
    ['div.workout-editor-header', [
      ['input.workout-name', {
        type: 'text', value: workout.name, oninput: (e) => { workout.name = e.target.value; save(); },
      }],
      ['button.btn-danger', { onclick: () => App.deleteWorkout(plan, workout) }, [trashIcon()]],
    ]],
    ['div.node-list', workout.nodes.map((n, i) => nodeRowEditor(workout.nodes, i, save))],
    ['div.add-node-actions', [
      ['button.btn-secondary', {
        onclick: () => { workout.nodes.push(newExercise({ unit: App.settings.unit })); save(); },
      }, '+ Add Exercise'],
      ['button.btn-secondary', {
        onclick: () => { workout.nodes.push(newGroup({ children: [newExercise({ unit: App.settings.unit })] })); save(); },
      }, '+ Add Group (Superset)'],
    ]],
  ]];
}

function planEditorView() {
  const plan = App.plans.find((p) => p.id === App.editingPlanId);
  if (!plan) return ['div.container', [['section', [['p', 'Plan not found.']]]]];
  const save = () => App.savePlans();
  return ['div.container', [
    ['nav.page-nav', [
      ['button.btn-secondary', { onclick: () => { App.editingPlanId = null; App.page = 'home'; } }, '← Back'],
      ['button.btn-danger', { onclick: () => App.deletePlan(plan) }, [trashIcon()]],
    ]],
    ['section', [
      ['input.plan-name', { type: 'text', value: plan.name, oninput: (e) => { plan.name = e.target.value; save(); } }],
    ]],
    ['div.workout-editor-list', plan.workouts.map((w) => workoutEditorSection(plan, w, save))],
    ['section', [
      ['button.btn-primary', { onclick: () => App.addWorkout(plan) }, '+ Add Workout'],
    ]],
    ['section', [
      ['h3', 'Cycle Order'],
      ['p.hint', 'Tap workouts below to build the order you cycle through, e.g. A, B, A.'],
      ['div.cycle-sequence', plan.cycle.length
        ? plan.cycle.map((wid, i) => {
          const w = plan.workouts.find((x) => x.id === wid);
          return ['button.chip', {
            key: `cyc-${i}`,
            onclick: () => { plan.cycle.splice(i, 1); if (plan.cursor >= plan.cycle.length) plan.cursor = 0; save(); },
          }, `${w ? w.name : '(deleted)'} ✕`];
        })
        : [['span.hint', 'No cycle set yet — add workouts above.']]],
      ['div.cycle-add', plan.workouts.map((w) => ['button.btn-secondary', {
        key: w.id,
        onclick: () => { plan.cycle.push(w.id); save(); },
      }, `+ ${w.name}`])],
    ]],
  ]];
}

// Icon + weight-change detail, via the same model.js helpers the workout
// recap uses (summaryExerciseRow), so a session's exercises read the same
// way here as they did right after you logged them. progressionChangeDetail
// returns null for sessions logged before change/weightFrom/weightTo
// existed in the stored-entry shape, rather than showing "undefined".
function sessionDetailRow(e) {
  const detail = progressionChangeDetail(e.change, e.weightFrom, e.weightTo, e.unit);
  return ['div.session-detail-row', { key: e.nodeId }, [
    ['div.session-exercise-header', [
      changeIcon(e.change),
      ['span.session-exercise-name', e.name],
      detail ? ['span.summary-exercise-detail', detail] : null,
    ]],
    ['div.session-exercise-sets', e.sets.map((set, i) => ['span.past-set', { key: i }, e.bodyweight ? `${set.reps} reps` : `${set.weight}${e.unit}×${set.reps}`])],
  ]];
}

// Date / day / plan / workout as separate grid columns (not one joined
// string) so the same field lines up vertically down the whole list.
function sessionRow(s) {
  const plan = App.plans.find((p) => p.id === s.planId);
  const workout = plan && plan.workouts.find((w) => w.id === s.workoutId);
  const expanded = App.expandedSessionId === s.id;

  return ['div.row.session-row', { key: s.id }, [
    ['div.row-main', { onclick: () => { App.expandedSessionId = expanded ? null : s.id; } }, [
      ['div.session-row-fields', [
        ['span.session-col-date', shortMonthDay(s.date)],
        ['span.session-col-day', weekdayAbbr(s.date)],
        ['span.session-col-plan', plan ? plan.name : '(deleted plan)'],
        ['span.session-col-workout', workout ? workout.name : '—'],
      ]],
      ['div.session-row-right', [
        ['span.row-progress', `${formatVolume(sessionVolume(s))} ${App.settings.unit}`],
        App.historyEditMode ? ['button.btn-danger.icon-btn', {
          onclick: (e) => { e.stopPropagation(); App.deleteSession(s); },
        }, [trashIcon()]] : null,
      ]],
    ]],
    expanded ? ['div.session-detail', [
      ['div.session-detail-entries', s.entries.map((e) => sessionDetailRow(e))],
    ]] : null,
  ]];
}

function sessionsTabView(finished) {
  if (!finished.length) return ['p.empty-hint', 'No sessions logged yet.'];

  const groups = [];
  finished.forEach((s) => {
    const year = s.date.slice(0, 4);
    let group = groups.find((g) => g.year === year);
    if (!group) { group = { year, sessions: [] }; groups.push(group); }
    group.sessions.push(s);
  });

  return ['div.session-groups', [
    ['div.session-groups-header', [
      ['button.btn-secondary.btn-small', {
        onclick: () => { App.historyEditMode = !App.historyEditMode; },
      }, App.historyEditMode ? 'Done' : 'Edit'],
    ]],
    ['div.session-groups-list', groups.map((group) => ['div.session-year-group', { key: group.year }, [
      ['h3.session-year-heading', group.year],
      ['div.session-list', group.sessions.map((s) => sessionRow(s))],
    ]])],
  ]];
}

function progressTabView() {
  const names = distinctExerciseNames(App.sessions);
  if (!names.length) return ['p.empty-hint', 'No sessions logged yet.'];
  if (!App.progressExercise || !names.includes(App.progressExercise)) App.progressExercise = names[names.length - 1];
  const series = exerciseSeries(App.sessions, App.progressExercise);
  return ['div.progress-tab', [
    ['select.exercise-select', {
      value: App.progressExercise,
      onchange: (e) => { App.progressExercise = e.target.value; },
    }, names.map((n) => ['option', { value: n, key: n }, n])],
    LineChart.render(series.map((pt) => ({ date: pt.date, value: pt.volume }))),
  ]];
}

// Pure: the flat day-cell list for a month — `null` for the blank cells
// that pad the first and last weeks so the 1st lands under its weekday.
// Sunday-start, matching WEEKDAY_ABBR.
function monthCells(year, month, counts) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < new Date(year, month, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateStr, sessions: counts[dateStr] || 0 });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// Pure: the month `delta` months away from { year, month }.
function shiftMonth({ year, month }, delta) {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// Monthly calendar for the History screen: centered month title with
// prev/next arrows, a 7-column grid, and a green bubble on any day that
// has a finished session.
function historyCalendarView(finished) {
  const { year, month } = App.historyMonth;
  const counts = {};
  finished.forEach((s) => { counts[s.date] = (counts[s.date] || 0) + 1; });
  const cells = monthCells(year, month, counts);
  const today = localDateStr(new Date());
  const title = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });

  const dow = WEEKDAY_ABBR.map((w, i) => ['span.month-cal-dow', { key: `dow${i}` }, w]);
  const days = cells.map((cell, i) => {
    if (!cell) return ['span.month-cal-day.is-blank', { key: `blank${i}` }];
    const cls = [cell.sessions ? 'is-worked' : '', cell.dateStr === today ? 'is-today' : ''].join(' ').trim();
    return ['span.month-cal-day', {
      key: cell.dateStr,
      class: cls,
      title: cell.sessions ? `${shortMonthDay(cell.dateStr)}: ${cell.sessions} session${cell.sessions === 1 ? '' : 's'}` : undefined,
    }, [['span.month-cal-daynum', String(cell.day)]]];
  });

  return ['div.month-cal', [
    ['div.month-cal-nav', [
      ['button.month-cal-arrow', {
        'aria-label': 'Previous month',
        onclick: () => { App.historyMonth = shiftMonth(App.historyMonth, -1); },
      }, '‹'],
      ['span.month-cal-title', title],
      ['button.month-cal-arrow', {
        'aria-label': 'Next month',
        onclick: () => { App.historyMonth = shiftMonth(App.historyMonth, 1); },
      }, '›'],
    ]],
    ['div.month-cal-grid', [...dow, ...days]],
  ]];
}

function historyView() {
  const finished = App.sessions.filter((s) => s.finishedAt).slice().sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
  return ['div.container', [
    ['section', [
      ['h2', 'History'],
      ['div.stat-row', [
        ['div.stat-tile', [['span.stat-value', totalSessions(finished).toString()], ['span.stat-label', 'Sessions']]],
        ['div.stat-tile', [
          ['span.stat-value', `${formatVolume(totalWeightLifted(finished))} ${App.settings.unit}`],
          ['span.stat-label', 'Weight Lifted'],
        ]],
      ]],
      historyCalendarView(finished),
    ]],
    ['section', [
      ['div.tabs', [
        ['button.tab', { class: App.historyTab === 'sessions' ? 'active' : '', onclick: () => { App.historyTab = 'sessions'; } }, 'Sessions'],
        ['button.tab', { class: App.historyTab === 'progress' ? 'active' : '', onclick: () => { App.historyTab = 'progress'; } }, 'Progress'],
      ]],
      App.historyTab === 'sessions' ? sessionsTabView(finished) : progressTabView(),
    ]],
  ]];
}

function settingsView() {
  return ['div.container', [
    ['section', [
      ['h2', 'Settings'],
      ['div.field-row', [
        ['span', 'Units'],
        ['div.unit-toggle', [
          ['button', { class: App.settings.unit === 'lb' ? 'active' : '', onclick: () => { App.settings.unit = 'lb'; App.saveSettings(); } }, 'lb'],
          ['button', { class: App.settings.unit === 'kg' ? 'active' : '', onclick: () => { App.settings.unit = 'kg'; App.saveSettings(); } }, 'kg'],
        ]],
      ]],
      ['h3', 'Backup — everything'],
      ['div.settings-actions', [
        ['button.btn-secondary', { onclick: () => Storage.exportJSON(App.plans, App.sessions, App.settings) }, 'Export JSON'],
        ['button.btn-secondary', { onclick: () => Storage.exportCSV(App.sessions, App.plans) }, 'Export CSV'],
        ['button.btn-secondary', { onclick: () => document.getElementById('import-input').click() }, 'Import JSON'],
        ['input#import-input', {
          type: 'file',
          accept: 'application/json',
          style: { display: 'none' },
          onchange: (e) => { if (e.target.files.length) App.importJSON(e.target.files[0]); },
        }],
      ]],
      ['h3', 'Backup — plans only'],
      ['p.hint', 'Just your workout plans, no logged history — for moving/sharing plan structure without dragging your training log along.'],
      ['div.settings-actions', [
        ['button.btn-secondary', { onclick: () => Storage.exportPlansJSON(App.plans) }, 'Export Plans'],
        ['button.btn-secondary', { onclick: () => document.getElementById('import-plans-input').click() }, 'Import Plans'],
        ['input#import-plans-input', {
          type: 'file',
          accept: 'application/json',
          style: { display: 'none' },
          onchange: (e) => { if (e.target.files.length) App.importPlansJSON(e.target.files[0]); },
        }],
      ]],
      ['h3', 'Data'],
      ['p.hint', '"Add Test Data" simulates a few weeks of history against your active plan, so there\'s something to look at — handy for previewing the app. "Reset Data" wipes everything back to a fresh install.'],
      ['div.settings-actions', [
        ['button.btn-secondary', { onclick: () => App.addTestData() }, 'Add Test Data'],
        ['button.btn-danger', { onclick: () => App.resetData() }, 'Reset Data'],
      ]],
      ['p.hint', 'On your phone, use your browser’s "Add to Home Screen" / "Install App" option to use this like a native app.'],
    ]],
  ]];
}

function pageView() {
  switch (App.page) {
    case 'home': return homeView();
    case 'planEditor': return planEditorView();
    case 'session': return activeSessionView();
    case 'sessionSummary': return sessionSummaryView();
    case 'history': return historyView();
    case 'settings': return settingsView();
    default: return homeView();
  }
}

function tabBarItem(page, label) {
  return ['button.tab-bar-item', {
    class: App.page === page ? 'active' : '',
    onclick: () => App.goto(page),
  }, label];
}

// Shown once a newer service worker has finished installing and is
// waiting to take over (see the registration block at the bottom of this
// file). "Reload" activates it and refreshes into the new version.
function updateBanner() {
  if (!App.updateReady) return null;
  return ['div.update-banner', [
    ['span', 'New version available'],
    ['button', { onclick: () => App.applyUpdate() }, 'Reload'],
  ]];
}

// The bottom bar is always present, but its content is contextual: normal
// Home/History/Settings tabs, or — while a workout is in progress — the
// workout name plus Cancel/Finish, so those controls stay reachable
// without a dedicated in-page header.
function bottomBar() {
  if (App.page === 'session') {
    const elapsedSeconds = (Date.now() - new Date(App.session.startedAt).getTime()) / 1000;
    return ['nav.tab-bar.session-bar', [
      ['span.session-bar-title', `Workout ${App.currentWorkout().name} · ${formatElapsed(elapsedSeconds)}`],
      ['div.session-bar-actions', [
        ['button.btn-secondary', { onclick: () => App.cancelSession() }, 'Cancel'],
        ['button.btn-success', { onclick: () => App.finishWorkout() }, 'Finish'],
      ]],
    ]];
  }
  return ['nav.tab-bar', [
    tabBarItem('home', 'Home'),
    tabBarItem('history', 'History'),
    tabBarItem('settings', 'Settings'),
  ]];
}

// ---------------------------------------------------------------------
// App state + controller
// ---------------------------------------------------------------------

const App = {
  page: 'home',
  plans: [],
  sessions: [],
  settings: { ...DEFAULT_SETTINGS },

  // Active session — plan/workout are derived from session.planId/workoutId
  // (see currentPlan/currentWorkout) rather than stored separately, so
  // there's nowhere for them to drift out of sync with the session itself.
  session: null,
  logDraft: {}, // leaf path -> { weight, reps }
  rest: { endsAt: null, timerId: null }, // endsAt: ms timestamp, not a countdown — see restSecondsLeft
  workoutClockId: null, // ticks the bottom bar's elapsed-time display; see startWorkoutClock
  finishSummary: null,

  // Service-worker update banner (see the registration block at the
  // bottom of this file). A newer worker installs but waits; the banner
  // lets the user activate it and reload into the new version.
  swRegistration: null,
  updateReady: false,
  applyingUpdate: false,

  // Editors
  editingPlanId: null,

  // History
  historyTab: 'sessions',
  expandedSessionId: null,
  progressExercise: null,
  historyEditMode: false,
  // Month shown by the History calendar (view-only, not persisted).
  historyMonth: { year: new Date().getFullYear(), month: new Date().getMonth() },

  oninit: () => {
    App.plans = Storage.loadPlans();
    App.sessions = Storage.loadSessions();
    App.settings = Storage.loadSettings();

    if (App.plans.length === 0) {
      App.seedDefaultPlans();
    }

    const active = Storage.loadActiveSession();
    if (active) {
      const plan = App.plans.find((p) => p.id === active.planId);
      const workout = plan && plan.workouts.find((w) => w.id === active.workoutId);
      if (plan && workout) {
        App.session = active;
        App.startWorkoutClock();
        App.page = 'session';
      } else {
        Storage.clearActiveSession();
      }
    }
  },

  // Derived from session.planId/workoutId rather than stored — only
  // meaningful while a session is in progress.
  currentPlan: () => App.plans.find((p) => p.id === App.session.planId),
  currentWorkout: () => {
    const plan = App.currentPlan();
    return plan && plan.workouts.find((w) => w.id === App.session.workoutId);
  },

  savePlans: () => Storage.savePlans(App.plans),
  saveSessions: () => Storage.saveSessions(App.sessions),
  saveSettings: () => Storage.saveSettings(App.settings),
  saveActiveSession: () => Storage.saveActiveSession(App.session),

  goto: (page) => { App.page = page; },

  // "Reload" on the update banner: promote the waiting worker, which
  // fires a controllerchange that reloads the page (see the registration
  // block). Falls back to a plain reload if there's no worker waiting.
  applyUpdate: () => {
    App.applyingUpdate = true;
    const waiting = App.swRegistration && App.swRegistration.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  },

  createPlan: () => {
    const plan = newPlan('New Plan');
    App.plans.push(plan);
    App.savePlans();
    App.editingPlanId = plan.id;
    App.page = 'planEditor';
  },

  // The two starter plans (no logged history) — used both on a genuine
  // first run and by "Reset Data" in Settings.
  seedDefaultPlans: () => {
    App.plans = [defaultPlan(), pushPullPlan()];
    App.savePlans();
  },

  // Settings > "Reset Data": back to a fresh install — the two starter
  // plans, no logged history, no in-progress workout.
  resetData: () => {
    if (!confirm('Reset all data? This deletes every plan and every logged workout — there\'s no undo.')) return;
    App.clearSession();
    App.sessions = [];
    App.saveSessions();
    App.seedDefaultPlans();
    App.page = 'home';
  },

  // Settings > "Add Test Data": simulates a few weeks of history against
  // the first plan (same generator used to preview the app before this
  // was made opt-in) so there's something to look at in History without
  // actually logging real workouts.
  addTestData: () => {
    const plan = App.plans[0];
    if (!plan) { alert('Create a plan first.'); return; }
    const demoSessions = seedDemoSessions(plan);
    App.sessions = App.sessions.concat(demoSessions);
    App.saveSessions();
    App.savePlans();
    alert(`Added ${demoSessions.length} test sessions to "${plan.name}".`);
  },

  deletePlan: (plan) => {
    if (!confirm(`Delete plan "${plan.name}"? This does not delete its logged history.`)) return;
    App.plans = App.plans.filter((p) => p.id !== plan.id);
    App.savePlans();
    if (App.editingPlanId === plan.id) { App.editingPlanId = null; App.page = 'home'; }
  },

  addWorkout: (plan) => {
    const workout = newWorkout(`Workout ${String.fromCharCode(65 + plan.workouts.length)}`);
    plan.workouts.push(workout);
    App.savePlans();
  },

  deleteWorkout: (plan, workout) => {
    if (!confirm(`Delete workout "${workout.name}"? This also removes it from the cycle.`)) return;
    plan.workouts = plan.workouts.filter((w) => w.id !== workout.id);
    plan.cycle = plan.cycle.filter((id) => id !== workout.id);
    if (plan.cursor >= plan.cycle.length) plan.cursor = 0;
    App.savePlans();
  },

  deleteSession: (session) => {
    if (!confirm(`Delete this session (${shortMonthDay(session.date)})? This can't be undone.`)) return;
    App.sessions = App.sessions.filter((s) => s.id !== session.id);
    App.saveSessions();
  },

  startSession: (plan, workout) => {
    App.session = newSession(plan, workout);
    App.logDraft = {};
    App.saveActiveSession();
    App.startWorkoutClock();
    App.page = 'session';
  },

  logLeafSet: (node, path, draft) => {
    logSet(App.session, path, draft.reps, draft.weight);
    App.saveActiveSession();
    if (node.restSeconds) App.startRest(node.restSeconds);
  },

  logGroupSet: (groupNode, groupPath, leafPath, draft) => {
    const { roundCompleted } = logGroupSet(App.session, groupNode, groupPath, leafPath, draft.reps, draft.weight);
    App.saveActiveSession();
    if (roundCompleted && groupNode.restSeconds) App.startRest(groupNode.restSeconds);
  },

  // One extra loggable set for just this session — doesn't touch the plan template.
  addExtraSet: (path) => {
    App.session.extraSets[path] = (App.session.extraSets[path] || 0) + 1;
    App.saveActiveSession();
  },

  // An exercise done today that wasn't in the plan. Added to the actual
  // workout (not just this session) since if it's worth doing once, it's
  // reasonable for it to show up next time this workout comes around too
  // — it can always be removed later from the Plan Editor.
  addAdHocExercise: () => {
    const name = (prompt('Exercise name?') || '').trim();
    if (!name) return;
    App.currentWorkout().nodes.push(newExercise({ name, unit: App.settings.unit }));
    App.savePlans();
  },

  startRest: (seconds) => {
    App.stopRest();
    App.rest.endsAt = Date.now() + seconds * 1000;
    App.rest.timerId = setInterval(() => {
      if (restSecondsLeft() <= 0) App.stopRest();
      m.redraw();
    }, 1000);
  },

  stopRest: () => {
    if (App.rest.timerId) clearInterval(App.rest.timerId);
    App.rest.timerId = null;
    App.rest.endsAt = null;
  },

  // Ticks the bottom bar's live elapsed-workout-time display. Also
  // timestamp-based (session.startedAt, computed fresh each tick) rather
  // than an incrementing counter, for the same reason as the rest
  // timer — stays correct even through a backgrounded/locked-screen tab.
  startWorkoutClock: () => {
    App.stopWorkoutClock();
    App.workoutClockId = setInterval(() => m.redraw(), 1000);
  },

  stopWorkoutClock: () => {
    if (App.workoutClockId) clearInterval(App.workoutClockId);
    App.workoutClockId = null;
  },

  // Tears down the in-progress session state — shared by finishing,
  // cancelling, and resetting, which otherwise each had to remember the
  // same handful of fields to null out in lockstep.
  clearSession: () => {
    App.stopRest();
    App.stopWorkoutClock();
    App.session = null;
    App.logDraft = {};
    Storage.clearActiveSession();
  },

  finishWorkout: () => {
    const plan = App.currentPlan();
    const workout = App.currentWorkout();
    const startedAt = App.session.startedAt;
    const results = finishSession(plan, workout, App.session);
    const setCount = App.session.entries.reduce((n, e) => n + e.sets.length, 0);
    const totalVolume = sessionVolume(App.session);
    const durationMs = new Date(App.session.finishedAt) - new Date(startedAt);
    App.sessions.push(App.session);
    App.saveSessions();
    App.savePlans();
    App.finishSummary = {
      workoutName: workout.name, plan, results, setCount, totalVolume, durationMs, unit: App.settings.unit,
    };
    App.clearSession();
    App.page = 'sessionSummary';
  },

  // A proposed weight change (increase or decrease — see model.js's
  // finishSession) isn't applied to the plan until accepted here. It
  // moves every exercise of the same name across the plan's workouts,
  // not just the one logged (Curls on A day and B day track together).
  acceptChange: (result) => {
    acceptProgressionChange(App.finishSummary.plan, result.name, result.to);
    result.accepted = true;
    App.savePlans();
  },

  acceptAllChanges: () => {
    App.finishSummary.results
      .filter((r) => isProposal(r) && !r.accepted)
      .forEach((r) => App.acceptChange(r));
  },

  // No confirmation — a deliberate choice: Cancel just exits, nothing logged.
  cancelSession: () => {
    App.clearSession();
    App.page = 'home';
  },

  importJSON: (file) => {
    Storage.importJSON(file)
      .then((data) => {
        App.plans = data.plans || [];
        App.sessions = data.sessions || [];
        App.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
        App.savePlans();
        App.saveSessions();
        App.saveSettings();
        alert('Import successful.');
        m.redraw();
      })
      .catch(() => alert('Could not read that file — is it a valid gym export?'));
  },

  importPlansJSON: (file) => {
    Storage.importJSON(file)
      .then((data) => {
        if (!Array.isArray(data.plans)) { alert('That file doesn’t look like a plans export.'); return; }
        App.plans = data.plans;
        App.savePlans();
        alert('Plans imported.');
        m.redraw();
      })
      .catch(() => alert('Could not read that file — is it a valid plans export?'));
  },

  view: () => h(['div.app-shell', [
    updateBanner(),
    pageView(),
    bottomBar(),
  ]]),
};

m.mount(document.getElementById('app-mount'), App);

// The rest timer and workout clock are timestamp-based specifically so
// they're correct the instant anything redraws them — but nothing
// redraws while the tab is hidden, so force one the moment you come
// back rather than waiting up to a second for the next regular tick.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) m.redraw();
});

// Registers the offline cache — see service-worker.js. A page freshly
// opened with no network at all can't run this for the first time (there's
// nothing to serve it from yet), but every visit after the first online one
// caches the app shell, so subsequent opens work with no signal.
//
// Update flow: a newly-deployed worker installs but stays "waiting" (it no
// longer calls skipWaiting on its own). When it reaches that state and an
// older worker is still controlling the page, App.updateReady flips on and
// the update banner appears. App.applyUpdate() posts SKIP_WAITING to it;
// the browser then swaps controllers, which fires controllerchange, and
// we reload once into the new version.
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (App.applyingUpdate && !reloading) { reloading = true; window.location.reload(); }
  });

  navigator.serviceWorker.register('service-worker.js')
    .then((reg) => {
      App.swRegistration = reg;
      // `controller` is null on the very first install — nothing to update
      // *from* — so a banner only makes sense when one already exists.
      const flagUpdate = () => {
        if (navigator.serviceWorker.controller) { App.updateReady = true; m.redraw(); }
      };
      if (reg.waiting) flagUpdate();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') flagUpdate();
        });
      });
    })
    .catch((err) => console.error('Service worker registration failed:', err));
}
