/**
 * Small pure SVG line-chart helper for the History Progress tab.
 * No charting library — same hand-rolled-SVG approach as common/heatmap.js.
 */

const LineChart = {
  // points: [{ date: "YYYY-MM-DD", value: number }], oldest first.
  render: (points = [], options = {}) => {
    const width = options.width || 600;
    const height = options.height || 220;
    const padding = { top: 12, right: 16, bottom: 26, left: 48 };

    if (!points.length) {
      return ['p.chart-empty', 'No sessions logged for this exercise yet.'];
    }

    const innerW = width - padding.left - padding.right;
    const innerH = height - padding.top - padding.bottom;

    const values = points.map((p) => p.value);
    const minV = Math.min(0, ...values);
    const maxV = Math.max(...values) || 1;
    const range = maxV - minV || 1;

    const x = (i) => padding.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const y = (v) => padding.top + innerH - ((v - minV) / range) * innerH;

    const polylinePoints = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');

    return ['svg.line-chart', {
      viewBox: `0 0 ${width} ${height}`,
      preserveAspectRatio: 'none',
    }, [
      ['line', { x1: padding.left, y1: padding.top, x2: padding.left, y2: height - padding.bottom, class: 'axis' }],
      ['line', {
        x1: padding.left, y1: height - padding.bottom, x2: width - padding.right, y2: height - padding.bottom, class: 'axis',
      }],
      ['text', { x: 4, y: padding.top + 8, class: 'axis-label' }, Math.round(maxV).toString()],
      ['text', { x: 4, y: height - padding.bottom, class: 'axis-label' }, Math.round(minV).toString()],
      ['polyline', { points: polylinePoints, class: 'line' }],
      points.map((p, i) => ['circle', {
        cx: x(i),
        cy: y(p.value),
        r: 4,
        class: 'point',
      }, [['title', `${p.date}: ${Math.round(p.value)}`]]]),
      ['text', { x: padding.left, y: height - 6, class: 'axis-label' }, points[0].date],
      ['text', { x: width - padding.right, y: height - 6, class: 'axis-label', 'text-anchor': 'end' }, points[points.length - 1].date],
    ]];
  },
};

/**
 * A GitHub-style activity heatmap, like common/heatmap.js, but aligned to
 * a calendar year (Jan 1 - Dec 31) instead of a rolling 53-week window —
 * kept local to the gym app rather than changing the shared component,
 * since other apps (pomodoro) rely on its rolling-window behavior.
 */
const YearHeatmap = {
  render: (items = [], options = {}) => {
    const timestampField = options.timestampField || 'date';
    const cellSize = 10;
    const gap = 2;
    const labelOffset = 4;
    const monthLabelHeight = 14;

    // `item[timestampField]` is expected to already be a local "YYYY-MM-DD"
    // day (e.g. session.date) — sliced as a string, never re-parsed through
    // `new Date()`, which would read it as UTC midnight and can shift it to
    // the wrong local day.
    const counts = {};
    let latestYear = null;
    items.forEach((item) => {
      const raw = item[timestampField];
      if (!raw) return;
      const key = String(raw).slice(0, 10);
      counts[key] = (counts[key] || 0) + 1;
      const y = Number(key.slice(0, 4));
      if (latestYear === null || y > latestYear) latestYear = y;
    });

    const year = options.year || latestYear || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(year, 11, 31);
    end.setDate(end.getDate() + (6 - end.getDay()));

    const weeks = [];
    const cur = new Date(start);
    while (cur <= end) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const inYear = cur.getFullYear() === year;
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
        week.push({ inYear, key, isFirstOfMonth: inYear && cur.getDate() === 1, month: cur.getMonth(), count: counts[key] || 0 });
        cur.setDate(cur.getDate() + 1);
      }
      weeks.push(week);
    }

    const getColor = (count) => {
      if (count === 0) return '#ebedf0';
      if (count === 1) return '#c6e48b';
      if (count === 2) return '#7bc96f';
      return '#196127';
    };

    const monthLabels = [];
    weeks.forEach((week, wi) => {
      const firstOfMonth = week.find((d) => d.isFirstOfMonth);
      if (firstOfMonth) {
        monthLabels.push({
          name: new Date(year, firstOfMonth.month, 1).toLocaleString('default', { month: 'short' }),
          x: labelOffset + wi * (cellSize + gap),
        });
      }
    });

    return ['svg.year-heatmap', {
      viewBox: `0 0 ${labelOffset + weeks.length * (cellSize + gap)} ${monthLabelHeight + 7 * (cellSize + gap)}`,
    }, [
      monthLabels.map((ml) => ['text', { key: `m-${ml.x}`, x: ml.x, y: 10, class: 'axis-label' }, ml.name]),
      // .filter(Boolean) matters here, not just style: this array is spread
      // into the svg's children (its own first element isn't a string, so
      // h()'s fragment-flatten path takes over) rather than reduced
      // element-by-element, which means the usual "falsy children get
      // dropped" handling does NOT apply — a stray `null` here reaches
      // h(null) directly and throws.
      weeks.flatMap((week, wi) => week.map((day, di) => (!day.inYear ? null : ['rect', {
        key: day.key,
        x: labelOffset + wi * (cellSize + gap),
        y: monthLabelHeight + di * (cellSize + gap),
        width: cellSize,
        height: cellSize,
        rx: 2,
        ry: 2,
        fill: getColor(day.count),
      }, [['title', `${day.key}: ${day.count} session${day.count === 1 ? '' : 's'}`]]]))).filter(Boolean),
    ]];
  },
};
