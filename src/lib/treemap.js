/**
 * src/lib/treemap.js
 * Pure squarified treemap layout algorithm (Bruls, Huizing, van Wijk).
 * No external libraries. Zero layout shifts, deterministic, theme-aware color mapping.
 */

/**
 * 5-step discrete color token mapping based on metric return (T10.3)
 * @param {number|null} value - Return in percent
 * @param {string} metric - '1d' | '1w' | '1m' | '3m'
 * @param {boolean} isDark - Whether theme is dark mode
 * @returns {string} Tailwind/Hex background color
 */
export function getMetricColor(value, metric = "1m", isDark = false) {
  if (value === null || value === undefined || isNaN(value)) {
    return isDark ? "#27272A" : "#F4F4F5"; // Neutral grey
  }

  // Thresholds for each window (±3% 1D, ±6% 1W, ±15% 1M, ±30% 3M)
  const clampThresholds = {
    "1d": 3.0,
    "1w": 6.0,
    "1m": 15.0,
    "3m": 30.0,
    "6m": 45.0,
  };
  const maxT = clampThresholds[metric.toLowerCase()] || 15.0;
  const ratio = Math.max(-1.0, Math.min(1.0, value / maxT));

  // 5 discrete steps per side: 0 to 0.2, 0.2 to 0.4, 0.4 to 0.6, 0.6 to 0.8, 0.8 to 1.0
  if (ratio > 0) {
    if (ratio < 0.2) return isDark ? "#064E3B" : "#D1FAE5"; // Emerald 900 / 100
    if (ratio < 0.4) return isDark ? "#065F46" : "#A7F3D0"; // Emerald 800 / 200
    if (ratio < 0.6) return isDark ? "#047857" : "#6EE7B7"; // Emerald 700 / 300
    if (ratio < 0.8) return isDark ? "#059669" : "#34D399"; // Emerald 600 / 400
    return isDark ? "#10B981" : "#10B981"; // Emerald 500 (max)
  } else if (ratio < 0) {
    const absRatio = Math.abs(ratio);
    if (absRatio < 0.2) return isDark ? "#4C0519" : "#FFE4E6"; // Rose 950 / 100
    if (absRatio < 0.4) return isDark ? "#881337" : "#FECDD3"; // Rose 900 / 200
    if (absRatio < 0.6) return isDark ? "#9F1239" : "#FDA4AF"; // Rose 800 / 300
    if (absRatio < 0.8) return isDark ? "#BE123C" : "#FB7185"; // Rose 700 / 400
    return isDark ? "#E11D48" : "#F43F5E"; // Rose 600 / 500 (max)
  }

  return isDark ? "#27272A" : "#F4F4F5";
}

/**
 * Text color for contrast with getMetricColor
 */
export function getMetricTextColor(value, metric = "1m", isDark = false) {
  if (value === null || value === undefined || isNaN(value)) {
    return isDark ? "#A1A1AA" : "#71717A";
  }
  const maxT = { "1d": 3.0, "1w": 6.0, "1m": 15.0, "3m": 30.0 }[metric.toLowerCase()] || 15.0;
  const absRatio = Math.min(1.0, Math.abs(value / maxT));

  if (isDark) {
    return "#FFFFFF";
  }
  return absRatio > 0.5 ? "#FFFFFF" : "#18181B";
}

/**
 * Squarified treemap layout generator.
 * @param {Array<{id: any, weight: number, [key: string]: any}>} items
 * @param {number} x - bounding box x
 * @param {number} y - bounding box y
 * @param {number} width - bounding box width
 * @param {number} height - bounding box height
 * @returns {Array<{...item, x: number, y: number, width: number, height: number}>}
 */
export function computeSquarifiedTreemap(items, x = 0, y = 0, width = 1000, height = 600) {
  if (!items || items.length === 0 || width <= 0 || height <= 0) {
    return [];
  }

  // Filter out non-positive or NaN weights
  const validItems = items
    .filter((item) => typeof item.weight === "number" && !isNaN(item.weight) && item.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  if (validItems.length === 0) {
    return [];
  }

  const totalWeight = validItems.reduce((acc, it) => acc + it.weight, 0);
  const totalArea = width * height;

  // Normalized area for each item
  const elements = validItems.map((it) => ({
    ...it,
    area: (it.weight / totalWeight) * totalArea,
  }));

  const layout = [];
  squarify(elements, [], { x, y, width, height }, layout);
  return layout;
}

function squarify(children, row, container, layout) {
  if (children.length === 0) {
    if (row.length > 0) {
      layoutRow(row, container, layout);
    }
    return;
  }

  const c = children[0];
  const shorterSide = Math.min(container.width, container.height);

  if (row.length === 0) {
    squarify(children.slice(1), [c], container, layout);
    return;
  }

  const currentWorst = worstAspectRatio(row, shorterSide);
  const nextWorst = worstAspectRatio([...row, c], shorterSide);

  if (currentWorst >= nextWorst) {
    squarify(children.slice(1), [...row, c], container, layout);
  } else {
    const remainingContainer = layoutRow(row, container, layout);
    squarify(children, [], remainingContainer, layout);
  }
}

function worstAspectRatio(row, shorterSide) {
  if (row.length === 0 || shorterSide === 0) return Infinity;
  let minArea = Infinity;
  let maxArea = -Infinity;
  let sumArea = 0;

  for (const item of row) {
    sumArea += item.area;
    if (item.area < minArea) minArea = item.area;
    if (item.area > maxArea) maxArea = item.area;
  }

  const sideSquared = shorterSide * shorterSide;
  const sumSquared = sumArea * sumArea;

  const w1 = (sideSquared * maxArea) / sumSquared;
  const w2 = sumSquared / (sideSquared * minArea);
  return Math.max(w1, w2);
}

function layoutRow(row, container, layout) {
  const sumArea = row.reduce((sum, item) => sum + item.area, 0);
  const isHorizontal = container.width >= container.height;

  if (isHorizontal) {
    const rowWidth = sumArea / container.height;
    let curY = container.y;

    for (const item of row) {
      const itemHeight = item.area / rowWidth;
      layout.push({
        ...item,
        x: Math.round(container.x * 10) / 10,
        y: Math.round(curY * 10) / 10,
        width: Math.max(1, Math.round(rowWidth * 10) / 10),
        height: Math.max(1, Math.round(itemHeight * 10) / 10),
      });
      curY += itemHeight;
    }

    return {
      x: container.x + rowWidth,
      y: container.y,
      width: Math.max(0, container.width - rowWidth),
      height: container.height,
    };
  } else {
    const rowHeight = sumArea / container.width;
    let curX = container.x;

    for (const item of row) {
      const itemWidth = item.area / rowHeight;
      layout.push({
        ...item,
        x: Math.round(curX * 10) / 10,
        y: Math.round(container.y * 10) / 10,
        width: Math.max(1, Math.round(itemWidth * 10) / 10),
        height: Math.max(1, Math.round(rowHeight * 10) / 10),
      });
      curX += itemWidth;
    }

    return {
      x: container.x,
      y: container.y + rowHeight,
      width: container.width,
      height: Math.max(0, container.height - rowHeight),
    };
  }
}
