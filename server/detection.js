/**
 * AI Mouse Check - Server-side detection algorithms
 * These are the SAME algorithms as the client, run server-side for tamper-proofing
 *
 * Usage:
 *   const { analyzeMovement, generateSignature } = require('./detection');
 *   const result = analyzeMovement(movementPoints, { targetHitsRequired: 5 });
 */

const crypto = require('crypto');

/**
 * Analyze mouse movement data for human characteristics
 * @param {Array} points - Array of {x, y, t} movement points
 * @param {Object} options - Configuration options
 * @returns {Object} Analysis result with checks and verification status
 */
function analyzeMovement(points, options = {}) {
  const targetHitsRequired = options.targetHitsRequired || 5;
  const targetHits = options.targetHits || 0;

  const checks = {
    speed: false,
    curves: false,
    jitter: false,
    timing: false,
    continuous: false,
    notRobotic: true
  };

  if (!points || points.length < 15) {
    return {
      verified: false,
      reason: 'insufficient_data',
      checks,
      checksPassed: 0,
      aiDetected: false
    };
  }

  // 1. Speed variation (Fitts's Law)
  // Humans accelerate and decelerate naturally
  const speeds = [];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    const dt = points[i].t - points[i - 1].t;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dt > 0 && dist > 0) speeds.push(dist / dt);
  }

  if (speeds.length > 10) {
    const thirds = Math.floor(speeds.length / 3);
    const avgFirst = speeds.slice(0, thirds).reduce((a, b) => a + b, 0) / thirds;
    const avgLast = speeds.slice(-thirds).reduce((a, b) => a + b, 0) / thirds;
    const hasVariation = Math.abs(avgFirst - avgLast) > 0.05;
    const hasOverall = Math.max(...speeds) > Math.min(...speeds) * 1.5;
    checks.speed = hasVariation || hasOverall;
  }

  // 2. Path curvature
  // Humans create smooth curves, AI creates straight segments
  let smoothCount = 0;
  let angleCount = 0;
  for (let i = 2; i < points.length; i++) {
    const v1x = points[i - 1].x - points[i - 2].x;
    const v1y = points[i - 1].y - points[i - 2].y;
    const v2x = points[i].x - points[i - 1].x;
    const v2y = points[i].y - points[i - 1].y;
    const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

    if (mag1 > 0.5 && mag2 > 0.5) {
      const dot = v1x * v2x + v1y * v2y;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));
      angleCount++;
      if (angle < 0.3) smoothCount++;
    }
  }
  const smoothRatio = smoothCount / Math.max(1, angleCount);
  checks.curves = smoothRatio > 0.3 && smoothRatio < 0.95;

  // 3. Micro-movements (physiological jitter)
  // Humans have natural hand tremor
  let reversals = 0;
  let lastDx = 0, lastDy = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    if ((lastDx > 0 && dx < 0) || (lastDx < 0 && dx > 0)) reversals++;
    if ((lastDy > 0 && dy < 0) || (lastDy < 0 && dy > 0)) reversals++;
    lastDx = dx;
    lastDy = dy;
  }
  const reversalRatio = reversals / points.length;
  checks.jitter = reversalRatio < 0.6;

  // 4. Timing patterns
  // Humans have natural pauses and continuous movement
  const duration = points[points.length - 1].t - points[0].t;
  let pauseCount = 0;
  let longPauseCount = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 50) pauseCount++;
    if (dt > 150) longPauseCount++;
  }
  const pauseRatio = pauseCount / points.length;
  checks.timing = duration > 300 && pauseRatio < 0.3 && longPauseCount < points.length * 0.1;

  // 5. Continuous flow
  // Humans generate continuous mousemove events
  const timeGaps = [];
  for (let i = 1; i < points.length; i++) {
    timeGaps.push(points[i].t - points[i - 1].t);
  }
  const smallGaps = timeGaps.filter(g => g < 30).length;
  const continuousRatio = smallGaps / timeGaps.length;
  const pointsPerSecond = points.length / (duration / 1000);
  checks.continuous = continuousRatio > 0.4 && pointsPerSecond > 15;

  // 6. Straight line detection
  // AI moves in straight lines with zero deviation
  // Measure how much the actual path deviates from a best-fit line
  // If average deviation is near zero, it's robotic

  // Check segments of 20 points for straightness
  const segmentSize = 20;
  let tooStraightSegments = 0;
  let totalSegments = 0;

  for (let start = 0; start < points.length - segmentSize; start += 10) {
    const segment = points.slice(start, start + segmentSize);

    // Fit a line from first to last point
    const x1 = segment[0].x, y1 = segment[0].y;
    const x2 = segment[segment.length - 1].x, y2 = segment[segment.length - 1].y;
    const lineLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

    if (lineLen < 10) continue; // Skip tiny movements

    // Calculate average perpendicular distance from line
    let totalDeviation = 0;
    for (let i = 1; i < segment.length - 1; i++) {
      // Distance from point to line
      const px = segment[i].x, py = segment[i].y;
      const dist = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / lineLen;
      totalDeviation += dist;
    }

    const avgDeviation = totalDeviation / (segment.length - 2);
    const deviationRatio = avgDeviation / lineLen;

    totalSegments++;
    // If deviation is less than 0.5% of line length AND absolute deviation < 2px, it's too straight
    // This catches truly robotic movement while allowing fast human swipes
    if (deviationRatio < 0.005 && avgDeviation < 2) {
      tooStraightSegments++;
    }
  }

  // Fail if more than 50% of segments are perfectly straight (no noise at all)
  const straightRatio = totalSegments > 0 ? tooStraightSegments / totalSegments : 0;
  checks.notRobotic = straightRatio < 0.5;

  // Calculate results
  const checkValues = [checks.speed, checks.curves, checks.jitter, checks.timing, checks.continuous, checks.notRobotic];
  const targetCheck = targetHits >= targetHitsRequired;
  const checksPassed = checkValues.filter(Boolean).length + (targetCheck ? 1 : 0);

  // AI detection: if 2+ of the AI-sensitive checks fail
  const aiFailures = [!checks.curves, !checks.continuous, !checks.notRobotic, !checks.timing].filter(Boolean).length;
  const aiDetected = aiFailures >= 2;

  const allPassed = checkValues.every(Boolean) && targetCheck;

  return {
    verified: allPassed,
    checks,
    checksPassed,
    totalChecks: 7,
    aiDetected,
    duration,
    pointCount: points.length,
    metrics: {
      speedVariation: speeds.length > 0 ? Math.max(...speeds) / Math.min(...speeds) : 0,
      smoothRatio,
      reversalRatio,
      continuousRatio,
      pointsPerSecond,
      straightRatio
    }
  };
}

/**
 * Generate a cryptographic signature for verified movement
 * @param {string} secretKey - Server-side secret key
 * @param {Object} data - Data to sign
 * @returns {Object} Signature and metadata
 */
function generateSignature(secretKey, data) {
  const timestamp = Date.now();
  const payload = JSON.stringify({
    movementHash: hashMovement(data.points),
    recordId: data.recordId,
    timestamp,
    checksPassed: data.checksPassed
  });

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');

  return {
    signature,
    timestamp,
    payload
  };
}

/**
 * Verify a signature
 * @param {string} secretKey - Server-side secret key
 * @param {string} signature - The signature to verify
 * @param {string} payload - The original payload
 * @returns {boolean} Whether the signature is valid
 */
function verifySignature(secretKey, signature, payload) {
  const expectedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Hash movement data for integrity checking
 * @param {Array} points - Movement points
 * @returns {string} Hash of the movement data
 */
function hashMovement(points) {
  const data = JSON.stringify(points);
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex');
}

module.exports = {
  analyzeMovement,
  generateSignature,
  verifySignature,
  hashMovement
};
