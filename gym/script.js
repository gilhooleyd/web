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

function stepperControl(value, onChange, { min = 0, step = 1 } = {}) {
  return ['div.stepper', [
    ['button.stepper-btn', { onclick: () => onChange(Math.max(min, round(value - step))) }, '−'],
    ['span.stepper-value', round(value).toString()],
    ['button.stepper-btn', { onclick: () => onChange(round(value + step)) }, '+'],
  ]];
}

// A single clamped <input type="number">, for editor forms (not the live
// logging steppers above — those are stepperControl).
function numberInput(value, onChange, { min = 0, step = 1 } = {}) {
  return ['input', {
    type: 'number', min, step, value,
    oninput: (e) => onChange(Math.max(min, +e.target.value || min)),
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
// Once every planned set is logged, one more active-style row appears —
// its "Add Set" button both extends `totalSets` for just today
// (session.extraSets, not the plan template) and logs the set in one tap,
// rather than a separate always-visible "+ Add Set" button.
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
        ['span.set-value', `${logged[i].weight}${node.unit} × ${logged[i].reps}`],
        isLast ? ['span.set-undo', '↺'] : null,
      ]]);
    } else if (i === logged.length) {
      rows.push(['div.set-row.set-active', { key: `s${i}` }, [
        ['span.set-index', `${i + 1}`],
        stepperControl(draft.weight, (v) => { draft.weight = v; }, { min: 0, step: weightStep(node.unit) }),
        stepperControl(draft.reps, (v) => { draft.reps = v; }, { min: 0, step: 1 }),
        ['button.btn-success.set-log-btn', { onclick: () => onLog(draft) }, 'Log'],
      ]]);
    } else {
      rows.push(['div.set-row.set-future', { key: `s${i}` }, [
        ['span.set-index', `${i + 1}`],
        ['span.set-target', `${node.weight}${node.unit} × ${node.repRange.min}-${node.repRange.max}`],
      ]]);
    }
  }
  if (done) {
    rows.push(['div.set-row.set-active', { key: 'extra' }, [
      ['span.set-index', `${totalSets + 1}`],
      stepperControl(draft.weight, (v) => { draft.weight = v; }, { min: 0, step: weightStep(node.unit) }),
      stepperControl(draft.reps, (v) => { draft.reps = v; }, { min: 0, step: 1 }),
      ['button.btn-success.set-log-btn', { onclick: () => { App.addExtraSet(path); onLog(draft); } }, 'Add Set'],
    ]]);
  }

  return ['div.card.exercise-card', { key: path, class: done ? 'done' : '' }, [
    ['div.exercise-card-header', [
      ['span.exercise-name', node.name],
      ['span.exercise-target', `${node.repRange.min}-${node.repRange.max} reps`],
    ]],
    lastSet ? ['p.exercise-last', `Last: ${lastSet.weight}${node.unit} × ${lastSet.reps}`] : null,
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

function planRow(p) {
  const isActive = p.id === App.settings.activePlanId;
  return ['div.row.plan-row', { key: p.id }, [
    isActive
      ? ['span.badge.badge-active', 'Active']
      : ['button.btn-primary.btn-small', {
        onclick: () => { App.settings.activePlanId = p.id; App.saveSettings(); },
      }, 'Set Active'],
    ['span.row-name', p.name],
    ['button.icon-btn', { onclick: () => { App.editingPlanId = p.id; App.page = 'planEditor'; } }, [cogIcon()]],
  ]];
}

function homeView() {
  const plan = App.plans.find((p) => p.id === App.settings.activePlanId);
  const workout = plan && nextWorkout(plan);
  const otherWorkouts = plan && workout ? plan.workouts.filter((w) => w.id !== workout.id) : (plan ? plan.workouts : []);

  return ['div.container', [
    ['section.home-hero', !plan ? [
      ['h2', 'Welcome'],
      ['p', 'Create a plan below to get started.'],
    ] : [
      ['p.plan-label', plan.name],
      !workout ? [
        ['p', 'This plan has no workouts yet.'],
        ['button.btn-primary', { onclick: () => { App.editingPlanId = plan.id; App.page = 'planEditor'; } }, 'Add Workouts'],
      ] : [
        ['h2', `Next: Workout ${workout.name}`],
        ['button.btn-success.btn-large', { onclick: () => App.startSession(plan, workout) }, 'Start Workout'],
      ],
      otherWorkouts.length ? ['div.workout-picker', [
        ['span.workout-picker-label', 'Or start:'],
        ['div.workout-picker-chips', otherWorkouts.map((w) => ['button.btn-secondary.chip', {
          key: w.id,
          onclick: () => App.startSession(plan, w),
        }, w.name])],
      ]] : null,
    ]],
    ['section.plans-section', [
      ['h2', 'Plans'],
      App.plans.length === 0
        ? ['p.empty-hint', 'No plans yet.']
        : ['div.plan-list', App.plans.map((p) => planRow(p))],
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

// A proposed 'increase' needs an explicit Accept (see model.js's
// finishSession/acceptProgressionIncrease) — 'decrease' and 'none' are
// already applied or need no action, so they show no button.
function summaryExerciseRow(r) {
  return ['div.row.summary-exercise-row', { key: r.name }, [
    changeIcon(r.change),
    ['span.summary-exercise-name', r.name],
    ['span.summary-exercise-detail', progressionChangeDetail(r.change, r.from, r.to, r.unit)],
    r.change === 'increase' ? (r.accepted
      ? ['span.summary-accepted', '✓']
      : ['button.btn-success.btn-small', { onclick: () => App.acceptIncrease(r) }, 'Accept']) : null,
  ]];
}

function sessionSummaryView() {
  const summary = App.finishSummary;
  if (!summary) return null;
  const pendingIncreases = summary.results.filter((r) => r.change === 'increase' && !r.accepted);
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
      ['div.summary-exercises-header', [
        ['h3', 'Exercises'],
        pendingIncreases.length > 1
          ? ['button.btn-success.btn-small', { onclick: () => App.acceptAllIncreases() }, 'Accept All']
          : null,
      ]],
      ['div.summary-exercise-list', summary.results.map((r) => summaryExerciseRow(r))],
      ['button.btn-success', { onclick: () => { App.finishSummary = null; App.page = 'home'; } }, 'Done'],
    ]],
  ]];
}

function exerciseFieldsEditor(node, save) {
  return ['div.node-fields', [
    numberField('Sets', node.sets, (v) => { node.sets = v; save(); }, { min: 1 }),
    ['label.field', ['Reps', ['div.rep-range', [
      numberInput(node.repRange.min, (v) => { node.repRange.min = v; save(); }, { min: 1 }),
      ['span', '–'],
      numberInput(node.repRange.max, (v) => { node.repRange.max = v; save(); }, { min: 1 }),
    ]]]],
    ['label.field', ['Weight', ['div.weight-unit', [
      numberInput(node.weight, (v) => { node.weight = v; save(); }, { min: 0, step: 0.5 }),
      ['select', { value: node.unit, onchange: (e) => { node.unit = e.target.value; save(); } }, [
        ['option', { value: 'lb' }, 'lb'],
        ['option', { value: 'kg' }, 'kg'],
      ]],
    ]]]],
    numberField('Rest (sec)', node.restSeconds, (v) => { node.restSeconds = v; save(); }, { min: 0, step: 5 }),
    numberField('+/− weight on progression', node.progression.increment, (v) => { node.progression.increment = v; save(); }, { min: 0, step: 0.5 }),
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
    ['div.session-exercise-sets', e.sets.map((set, i) => ['span.past-set', { key: i }, `${set.weight}${e.unit}×${set.reps}`])],
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
      ['div.calendar-container', [YearHeatmap.render(finished, { timestampField: 'date' })]],
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

  // Editors
  editingPlanId: null,

  // History
  historyTab: 'sessions',
  expandedSessionId: null,
  progressExercise: null,
  historyEditMode: false,

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

  createPlan: () => {
    const plan = newPlan('New Plan');
    App.plans.push(plan);
    App.savePlans();
    if (!App.settings.activePlanId) { App.settings.activePlanId = plan.id; App.saveSettings(); }
    App.editingPlanId = plan.id;
    App.page = 'planEditor';
  },

  // The two starter plans (no logged history) — used both on a genuine
  // first run and by "Reset Data" in Settings.
  seedDefaultPlans: () => {
    const plan = defaultPlan();
    App.plans = [plan, pushPullPlan()];
    App.settings.activePlanId = plan.id;
    App.savePlans();
    App.saveSettings();
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
  // the active plan (same generator used to preview the app before this
  // was made opt-in) so there's something to look at in History without
  // actually logging real workouts.
  addTestData: () => {
    const plan = App.plans.find((p) => p.id === App.settings.activePlanId);
    if (!plan) { alert('No active plan to add test data to.'); return; }
    const demoSessions = seedDemoSessions(plan);
    App.sessions = App.sessions.concat(demoSessions);
    App.saveSessions();
    App.savePlans();
    alert(`Added ${demoSessions.length} test sessions to "${plan.name}".`);
  },

  deletePlan: (plan) => {
    if (!confirm(`Delete plan "${plan.name}"? This does not delete its logged history.`)) return;
    App.plans = App.plans.filter((p) => p.id !== plan.id);
    if (App.settings.activePlanId === plan.id) { App.settings.activePlanId = null; App.saveSettings(); }
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
      workoutName: workout.name, workout, results, setCount, totalVolume, durationMs, unit: App.settings.unit,
    };
    App.clearSession();
    App.page = 'sessionSummary';
  },

  // A proposed weight increase (see model.js's finishSession) isn't
  // applied to the plan until accepted here.
  acceptIncrease: (result) => {
    acceptProgressionIncrease(App.finishSummary.workout, result.nodeId, result.to);
    result.accepted = true;
    App.savePlans();
  },

  acceptAllIncreases: () => {
    App.finishSummary.results
      .filter((r) => r.change === 'increase' && !r.accepted)
      .forEach((r) => App.acceptIncrease(r));
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
