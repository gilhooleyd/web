/**
 * Shared Activity Heatmap component generator.
 * Creates a standard 53-week activity heatmap node structure.
 */
const SharedHeatmap = {
  /**
   * Generates the heatmap virtual node structure.
   * @param {Array} items - Array of items with timestamp values
   * @param {Object} options - Configuration options
   * @param {string} options.timestampField - Object field containing the ISO timestamp (default: 'started')
   */
  render: (items = [], options = {}) => {
    const timestampField = options.timestampField || 'started';
    const cellSize = 10;
    const gap = 2;
    const labelOffset = 30;
    const monthLabelHeight = 15;

    // Map of date string "YYYY-MM-DD" -> count
    const counts = {};
    items.forEach(item => {
      const timeVal = item[timestampField] || item['timestamp'];
      if (!timeVal) return;
      const d = new Date(timeVal);
      const dateStr = d.getFullYear() + '-' + 
                      String(d.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(d.getDate()).padStart(2, '0');
      counts[dateStr] = (counts[dateStr] || 0) + 1;
    });

    const today = new Date();
    let startDate;
    
    if (options.startOfYear) {
      startDate = new Date(today.getFullYear(), 0, 1);
      startDate.setDate(startDate.getDate() - startDate.getDay()); // Sunday on or before Jan 1st
    } else {
      const endOfWeek = new Date(today);
      endOfWeek.setDate(today.getDate() + (6 - today.getDay())); // Saturday
      
      startDate = new Date(endOfWeek);
      startDate.setDate(endOfWeek.getDate() - 370); // ~53 weeks ago
      startDate.setDate(startDate.getDate() - startDate.getDay()); // Sunday
    }

    const weeks = [];
    let currentDate = new Date(startDate);
    
    for (let w = 0; w < 53; w++) {
      const weekDays = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = currentDate.getFullYear() + '-' + 
                        String(currentDate.getMonth() + 1).padStart(2, '0') + '-' + 
                        String(currentDate.getDate()).padStart(2, '0');
        weekDays.push({
          dateStr: dateStr,
          date: new Date(currentDate),
          count: counts[dateStr] || 0
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      weeks.push(weekDays);
    }

    const getColor = (count) => {
      if (count === 0) return '#ebedf0';
      if (count <= 2) return '#c6e48b';
      if (count <= 4) return '#7bc96f';
      if (count <= 6) return '#239a3b';
      return '#196127';
    };

    const monthLabels = [];
    let lastMonth = -1;
    
    weeks.forEach((week, wIndex) => {
      const firstDay = week[0].date;
      const month = firstDay.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({
          name: firstDay.toLocaleString('default', { month: 'short' }),
          x: labelOffset + wIndex * (cellSize + gap)
        });
        lastMonth = month;
      }
    });

    return ["svg", {
      width: "100%",
      viewBox: `0 0 ${labelOffset + 53 * (cellSize + gap)} ${monthLabelHeight + 7 * (cellSize + gap) + 10}`,
      style: { display: 'block', overflow: 'visible', maxWidth: '680px', margin: '0 auto' }
    }, [
      // Month labels
      monthLabels.map(ml => ["text", {
        key: `month-${ml.x}`,
        x: ml.x,
        y: 10,
        "font-size": "9px",
        fill: "#767676"
      }, ml.name]),

      // Day labels
      ['Mon', 'Wed', 'Fri'].map((day) => {
        const dayIndex = day === 'Mon' ? 1 : (day === 'Wed' ? 3 : 5);
        return ["text", {
          key: `day-label-${day}`,
          x: 5,
          y: monthLabelHeight + dayIndex * (cellSize + gap) + cellSize - 1,
          "font-size": "9px",
          fill: "#767676"
        }, day];
      }),

      // Grid
      weeks.flatMap((week, wIndex) => {
        return week.map((day, dIndex) => {
          const x = labelOffset + wIndex * (cellSize + gap);
          const y = monthLabelHeight + dIndex * (cellSize + gap);
          const tooltipText = `${day.dateStr}: ${day.count} session${day.count === 1 ? '' : 's'}`;
          return ["rect", {
            key: `cell-${wIndex}-${dIndex}`,
            x: x,
            y: y,
            width: cellSize,
            height: cellSize,
            rx: 2,
            ry: 2,
            fill: getColor(day.count),
            title: tooltipText
          }, [
            ["title", tooltipText]
          ]];
        });
      })
    ]];
  }
};
