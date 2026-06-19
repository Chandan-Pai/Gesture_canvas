/**
 * shapeRecognizer.js
 * ------------------
 * Analyzes raw stroke points and determines if they match
 * a circle, rectangle, triangle, or straight line.
 * If matched, returns the canonical (perfect) version.
 */

export const ShapeType = {
  CIRCLE:    'circle',
  RECTANGLE: 'rectangle',
  LINE:      'line',
  TRIANGLE:  'triangle',
  UNKNOWN:   'unknown',
};

// ── Helpers ────────────────────────────────────────────────────────────

function boundingBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function centroid(pts) {
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

function distance([x1, y1], [x2, y2]) {
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Resample stroke to N evenly-spaced points */
function resample(pts, n = 64) {
  if (pts.length < 2) return pts;
  const totalLen = pts.reduce((acc, p, i) => i === 0 ? 0 : acc + distance(pts[i - 1], p), 0);
  const interval = totalLen / (n - 1);
  const out = [pts[0]];
  let D = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = distance(pts[i - 1], pts[i]);
    if (D + d >= interval) {
      const t = (interval - D) / d;
      const q = [
        pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]),
        pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
      ];
      out.push(q);
      pts = [q, ...pts.slice(i)];
      i = 0;
      D = 0;
    } else {
      D += d;
    }
    if (out.length === n - 1) break;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ── Circle detection ───────────────────────────────────────────────────

/**
 * Circularity score: 4π·Area / Perimeter²
 * Perfect circle = 1.0, square ≈ 0.785
 */
function circularityScore(pts) {
  const [cx, cy] = centroid(pts);
  const radii = pts.map(([x, y]) => distance([cx, cy], [x, y]));
  const avgR  = radii.reduce((a, b) => a + b, 0) / radii.length;
  const variance = radii.reduce((a, r) => a + (r - avgR) ** 2, 0) / radii.length;
  const cv = Math.sqrt(variance) / avgR;   // coefficient of variation
  return 1 - cv;                            // 1 = perfect circle
}

function isClosedStroke(pts, threshold = 0.35) {
  const span = distance(pts[0], pts[pts.length - 1]);
  const bb   = boundingBox(pts);
  const diag = Math.hypot(bb.w, bb.h);
  return span / diag < threshold;
}

// ── Rectangle detection ────────────────────────────────────────────────

function rectangularityScore(pts) {
  const bb = boundingBox(pts);
  if (bb.w < 5 || bb.h < 5) return 0;
  // Check how close each point is to one of the four edges
  let onEdgeCount = 0;
  const tol = Math.max(bb.w, bb.h) * 0.12;
  for (const [x, y] of pts) {
    const dL = Math.abs(x - bb.minX);
    const dR = Math.abs(x - bb.maxX);
    const dT = Math.abs(y - bb.minY);
    const dB = Math.abs(y - bb.maxY);
    if (Math.min(dL, dR, dT, dB) < tol) onEdgeCount++;
  }
  return onEdgeCount / pts.length;
}

// ── Line detection ─────────────────────────────────────────────────────

function lineScore(pts) {
  const [cx, cy] = centroid(pts);
  // Fit line via PCA — compute variance along primary axis
  let sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2;
    sxy += (x - cx) * (y - cy);
    syy += (y - cy) ** 2;
  }
  const n = pts.length;
  sxx /= n; sxy /= n; syy /= n;
  const lambda1 = (sxx + syy + Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2)) / 2;
  const lambda2 = (sxx + syy - Math.sqrt((sxx - syy) ** 2 + 4 * sxy ** 2)) / 2;
  return lambda2 < 0.001 ? 1 : 1 - (lambda2 / lambda1);
}

// ── Triangle detection ─────────────────────────────────────────────────

function triangleScore(pts) {
  // Approximate by finding inflection points (corners)
  const sampled = resample(pts, 32);
  let corners = 0;
  const windowSize = 4;
  for (let i = windowSize; i < sampled.length - windowSize; i++) {
    const before = sampled[i - windowSize];
    const p      = sampled[i];
    const after  = sampled[i + windowSize];
    const v1 = [p[0] - before[0], p[1] - before[1]];
    const v2 = [after[0] - p[0], after[1] - p[1]];
    const dot = v1[0]*v2[0] + v1[1]*v2[1];
    const mag = Math.hypot(...v1) * Math.hypot(...v2);
    if (mag < 0.01) continue;
    const cosAngle = dot / mag;
    if (cosAngle < 0.5) corners++;  // angle > 60°
  }
  return corners >= 2 && corners <= 5 ? corners / 3 : 0;
}

// ── Main classify ──────────────────────────────────────────────────────

export function classifyStroke(rawPts) {
  if (rawPts.length < 5) return { type: ShapeType.UNKNOWN, confidence: 0 };

  const pts    = resample(rawPts, 64);
  const closed = isClosedStroke(pts);
  const bb     = boundingBox(pts);
  const aspect = bb.w / Math.max(bb.h, 1);
  const roundAspect = aspect > 0.55 && aspect < 1.8;
  const circRaw = circularityScore(pts);
  // Allow slightly open loops that still read as circles
  const looksLikeCircle = closed || (roundAspect && circRaw > 0.58 && pts.length >= 16);

  const circScore = looksLikeCircle ? circRaw : 0;
  const rectScore = closed ? rectangularityScore(pts) : 0;
  const triScore  = closed ? triangleScore(pts) : 0;
  const lineScr   = !closed && !looksLikeCircle ? lineScore(pts) : 0;

  const scores = {
    [ShapeType.CIRCLE]:    circScore,
    [ShapeType.RECTANGLE]: rectScore,
    [ShapeType.TRIANGLE]:  triScore,
    [ShapeType.LINE]:      lineScr,
  };

  let best = ShapeType.UNKNOWN;
  let bestScore = 0.42;   // confidence threshold

  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) { best = type; bestScore = score; }
  }

  return { type: best, confidence: bestScore, boundingBox: bb, centroid: centroid(pts) };
}

// ── Canonical shape renderers ──────────────────────────────────────────

/**
 * Each returns a draw function: (ctx, color, lineWidth) => void
 */

export function makeCircle(result, rawPts) {
  const bb     = result.boundingBox;
  const [cx, cy] = result.centroid;
  const radius = (Math.min(bb.w, bb.h) / 2) * 0.95;
  return (ctx, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  };
}

export function makeRectangle(result) {
  const { minX, minY, w, h } = result.boundingBox;
  const pad = 4;
  return (ctx, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.roundRect(minX + pad, minY + pad, w - pad * 2, h - pad * 2, 4);
    ctx.stroke();
  };
}

export function makeLine(rawPts) {
  const start = rawPts[0];
  const end   = rawPts[rawPts.length - 1];
  return (ctx, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  };
}

export function makeTriangle(result) {
  const bb = result.boundingBox;
  const top   = [bb.minX + bb.w / 2, bb.minY];
  const botL  = [bb.minX, bb.maxY];
  const botR  = [bb.maxX, bb.maxY];
  return (ctx, color, lineWidth) => {
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(...top);
    ctx.lineTo(...botL);
    ctx.lineTo(...botR);
    ctx.closePath();
    ctx.stroke();
  };
}

export function getCanonicalRenderer(result, rawPts) {
  switch (result.type) {
    case ShapeType.CIRCLE:    return makeCircle(result, rawPts);
    case ShapeType.RECTANGLE: return makeRectangle(result);
    case ShapeType.LINE:      return makeLine(rawPts);
    case ShapeType.TRIANGLE:  return makeTriangle(result);
    default:                  return null;
  }
}
