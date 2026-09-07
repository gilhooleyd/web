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
