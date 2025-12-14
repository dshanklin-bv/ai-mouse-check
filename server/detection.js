/**
 * AI Mouse Check - Server-side detection algorithms
 * These are the SAME algorithms as the client, run server-side for tamper-proofing
 *
 * Usage:
 *   const { analyzeMovement, generateSignature } = require('./detection');
 *   const result = analyzeMovement(movementPoints, { targetHitsRequired: 5 });
 */

const crypto = require('crypto');

// Detection version - increment when changing thresholds or signals
const DETECTION_VERSION = '1.4.0';
const DETECTION_CONFIG = {
  signalThreshold: 3,              // Fail if 3+ signals trigger
  thresholds: {
    // Adjusted based on confusion matrix analysis (v1.4.0)
    jerkSpikeRatio: 0.035,
    accelSignChangeRate: 0.35,
    curvatureChangeRate: 0.12,
    velocityPeaksPerSecond: 2.0,
    pathEfficiency: 0.75,
    noiseAutocorr: 0.08,           // Relaxed from 0.15 (some humans have low autocorr)
    directionEntropy: 1.4,
    reversalRate: 0.02,
    // hesitationRate: REMOVED - bots hesitate MORE than some humans
    jerkAutocorr: 0.12,
    linearAccelRatio: 0.3,
    symmetryRatio: 0.6,
    xyNoiseCorr: 0.10,             // Relaxed from 0.15
    perfectStartRatio: 0.9,        // Relaxed from 0.7 (confident humans start cleanly)
    smoothStartRatio: 0.6,
    fidgetRatio: 0.10,
    // NEW strong signals based on analysis
    highReversalRatio: 0.15,       // Bots: 0.29-0.61, Humans: 0-0.01
    lowSmoothRatio: 0.45,          // Bots: 0.21-0.37, Humans: 0.62-0.85
    highCurvatureChange: 0.55      // Bots: 0.72-0.79, Humans: 0.23-0.41
  }
};

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
  const segmentSize = 20;
  let tooStraightSegments = 0;
  let totalSegments = 0;

  for (let start = 0; start < points.length - segmentSize; start += 10) {
    const segment = points.slice(start, start + segmentSize);
    const x1 = segment[0].x, y1 = segment[0].y;
    const x2 = segment[segment.length - 1].x, y2 = segment[segment.length - 1].y;
    const lineLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

    if (lineLen < 10) continue;

    let totalDeviation = 0;
    for (let i = 1; i < segment.length - 1; i++) {
      const px = segment[i].x, py = segment[i].y;
      const dist = Math.abs((y2 - y1) * px - (x2 - x1) * py + x2 * y1 - y2 * x1) / lineLen;
      totalDeviation += dist;
    }

    const avgDeviation = totalDeviation / (segment.length - 2);
    const deviationRatio = avgDeviation / lineLen;
    totalSegments++;
    if (deviationRatio < 0.005 && avgDeviation < 2) {
      tooStraightSegments++;
    }
  }

  const straightRatio = totalSegments > 0 ? tooStraightSegments / totalSegments : 0;

  // 7. Jerk analysis (third derivative) - detects Bezier curves
  // Bezier curves have smooth jerk, humans have irregular jerk with sudden spikes
  const velocities = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) {
      velocities.push({
        vx: (points[i].x - points[i - 1].x) / dt,
        vy: (points[i].y - points[i - 1].y) / dt,
        t: points[i].t
      });
    }
  }

  const accelerations = [];
  for (let i = 1; i < velocities.length; i++) {
    const dt = velocities[i].t - velocities[i - 1].t;
    if (dt > 0) {
      accelerations.push({
        ax: (velocities[i].vx - velocities[i - 1].vx) / dt,
        ay: (velocities[i].vy - velocities[i - 1].vy) / dt,
        t: velocities[i].t
      });
    }
  }

  const jerks = [];
  for (let i = 1; i < accelerations.length; i++) {
    const dt = accelerations[i].t - accelerations[i - 1].t;
    if (dt > 0) {
      const jx = (accelerations[i].ax - accelerations[i - 1].ax) / dt;
      const jy = (accelerations[i].ay - accelerations[i - 1].ay) / dt;
      jerks.push(Math.sqrt(jx * jx + jy * jy));
    }
  }

  // Human jerk has high variance with sudden spikes; Bezier is smooth
  let jerkVariance = 0;
  let jerkSpikes = 0;
  if (jerks.length > 10) {
    const jerkMean = jerks.reduce((a, b) => a + b, 0) / jerks.length;
    jerkVariance = jerks.reduce((sum, j) => sum + Math.pow(j - jerkMean, 2), 0) / jerks.length;
    const jerkStd = Math.sqrt(jerkVariance);
    // Count spikes (>2 std from mean)
    jerkSpikes = jerks.filter(j => Math.abs(j - jerkMean) > 2 * jerkStd).length;
  }
  const jerkSpikeRatio = jerks.length > 0 ? jerkSpikes / jerks.length : 0;

  // 8. Acceleration sign change frequency
  // Humans have many micro-corrections causing frequent sign changes
  // Bezier ease-in-out has very few sign changes
  let accelSignChanges = 0;
  let lastAccelSign = { x: 0, y: 0 };
  for (let i = 0; i < accelerations.length; i++) {
    const signX = Math.sign(accelerations[i].ax);
    const signY = Math.sign(accelerations[i].ay);
    if (lastAccelSign.x !== 0 && signX !== 0 && signX !== lastAccelSign.x) accelSignChanges++;
    if (lastAccelSign.y !== 0 && signY !== 0 && signY !== lastAccelSign.y) accelSignChanges++;
    if (signX !== 0) lastAccelSign.x = signX;
    if (signY !== 0) lastAccelSign.y = signY;
  }
  const accelSignChangeRate = accelerations.length > 0 ? accelSignChanges / accelerations.length : 0;

  // 9. Timing regularity detection
  // Bots often have very regular timing even with Gaussian noise
  // Human timing has higher entropy/irregularity
  let timingVariance = 0;
  if (timeGaps.length > 10) {
    const timingMean = timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length;
    timingVariance = timeGaps.reduce((sum, g) => sum + Math.pow(g - timingMean, 2), 0) / timeGaps.length;
  }
  const timingCV = timingVariance > 0 ? Math.sqrt(timingVariance) / (timeGaps.reduce((a, b) => a + b, 0) / timeGaps.length) : 0;

  // 10. Curvature consistency (Bezier detection)
  // Bezier curves have smoothly varying curvature
  // Humans have sudden curvature changes
  const curvatures = [];
  for (let i = 2; i < points.length; i++) {
    const v1x = points[i - 1].x - points[i - 2].x;
    const v1y = points[i - 1].y - points[i - 2].y;
    const v2x = points[i].x - points[i - 1].x;
    const v2y = points[i].y - points[i - 1].y;
    const cross = v1x * v2y - v1y * v2x;
    const dot = v1x * v2x + v1y * v2y;
    const angle = Math.atan2(cross, dot);
    curvatures.push(angle);
  }

  // Check for sudden curvature changes (humans have more)
  let suddenCurvatureChanges = 0;
  for (let i = 1; i < curvatures.length; i++) {
    const change = Math.abs(curvatures[i] - curvatures[i - 1]);
    if (change > 0.3) suddenCurvatureChanges++;
  }
  const curvatureChangeRate = curvatures.length > 0 ? suddenCurvatureChanges / curvatures.length : 0;

  // 11. Velocity peak analysis (sub-movement detection)
  // Humans make multiple ballistic sub-movements with distinct velocity peaks
  // Bezier ease-in-out has ONE smooth peak per movement
  const speedMagnitudes = velocities.map(v => Math.sqrt(v.vx * v.vx + v.vy * v.vy));
  let velocityPeaks = 0;
  for (let i = 2; i < speedMagnitudes.length - 2; i++) {
    // Local maximum detection with some smoothing
    const prev = (speedMagnitudes[i-2] + speedMagnitudes[i-1]) / 2;
    const curr = speedMagnitudes[i];
    const next = (speedMagnitudes[i+1] + speedMagnitudes[i+2]) / 2;
    if (curr > prev * 1.15 && curr > next * 1.15 && curr > 0.5) {
      velocityPeaks++;
    }
  }
  const velocityPeaksPerSecond = velocityPeaks / (duration / 1000);

  // 12. Path efficiency (wandering detection)
  // Bots take efficient paths; humans wander and hesitate
  let totalPathLength = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    totalPathLength += Math.sqrt(dx*dx + dy*dy);
  }
  const directDistance = Math.sqrt(
    Math.pow(points[points.length-1].x - points[0].x, 2) +
    Math.pow(points[points.length-1].y - points[0].y, 2)
  );
  const pathEfficiency = directDistance > 0 ? directDistance / totalPathLength : 0;

  // 13. Noise autocorrelation (detects synthetic Gaussian noise)
  // Bot noise is uncorrelated (white); human tremor has temporal correlation
  const residuals = [];
  for (let i = 2; i < points.length - 2; i++) {
    // Expected position from neighbors (simple smoothing)
    const expectedX = (points[i-2].x + points[i-1].x + points[i+1].x + points[i+2].x) / 4;
    const expectedY = (points[i-2].y + points[i-1].y + points[i+1].y + points[i+2].y) / 4;
    const residualX = points[i].x - expectedX;
    const residualY = points[i].y - expectedY;
    residuals.push({ x: residualX, y: residualY });
  }

  // Calculate lag-1 autocorrelation of residuals
  let autocorrSum = 0;
  let varianceSum = 0;
  if (residuals.length > 10) {
    const meanX = residuals.reduce((s, r) => s + r.x, 0) / residuals.length;
    const meanY = residuals.reduce((s, r) => s + r.y, 0) / residuals.length;
    for (let i = 1; i < residuals.length; i++) {
      autocorrSum += (residuals[i].x - meanX) * (residuals[i-1].x - meanX);
      autocorrSum += (residuals[i].y - meanY) * (residuals[i-1].y - meanY);
    }
    for (let i = 0; i < residuals.length; i++) {
      varianceSum += Math.pow(residuals[i].x - meanX, 2) + Math.pow(residuals[i].y - meanY, 2);
    }
  }
  const noiseAutocorr = varianceSum > 0 ? autocorrSum / varianceSum : 0;

  // 14. Direction change histogram (humans have characteristic distribution)
  // Bots have too uniform or too narrow distribution of direction changes
  const directionChanges = [];
  for (let i = 1; i < curvatures.length; i++) {
    directionChanges.push(Math.abs(curvatures[i]));
  }
  // Check if direction changes are too clustered (low entropy)
  const smallChanges = directionChanges.filter(d => d < 0.05).length;
  const mediumChanges = directionChanges.filter(d => d >= 0.05 && d < 0.2).length;
  const largeChanges = directionChanges.filter(d => d >= 0.2).length;
  const total = directionChanges.length || 1;
  const directionEntropy = -[smallChanges/total, mediumChanges/total, largeChanges/total]
    .filter(p => p > 0)
    .reduce((s, p) => s + p * Math.log2(p), 0);

  // 15. Overshoot detection
  // Humans naturally overshoot targets and correct back
  // Look for velocity reversals (direction flips) which indicate corrections
  let velocityReversals = 0;
  let lastVelAngle = null;
  for (let i = 0; i < velocities.length; i++) {
    const velAngle = Math.atan2(velocities[i].vy, velocities[i].vx);
    if (lastVelAngle !== null) {
      // Check for significant direction change (>90 degrees = reversal/correction)
      let angleDiff = Math.abs(velAngle - lastVelAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      if (angleDiff > Math.PI / 2) {
        velocityReversals++;
      }
    }
    lastVelAngle = velAngle;
  }
  const reversalRate = velocities.length > 0 ? velocityReversals / velocities.length : 0;

  // 16. Hesitation detection
  // Humans hesitate (brief pauses/slowdowns) before committing to a direction
  let hesitations = 0;
  for (let i = 5; i < speedMagnitudes.length - 5; i++) {
    const before = speedMagnitudes.slice(i-5, i).reduce((a,b) => a+b, 0) / 5;
    const at = speedMagnitudes[i];
    const after = speedMagnitudes.slice(i+1, i+6).reduce((a,b) => a+b, 0) / 5;
    // Hesitation: speed drops significantly then recovers
    if (at < before * 0.5 && at < after * 0.5 && before > 0.3 && after > 0.3) {
      hesitations++;
    }
  }
  const hesitationRate = speedMagnitudes.length > 0 ? hesitations / speedMagnitudes.length : 0;

  // 17. Jerk autocorrelation - human jerk has temporal structure, bot jerk is white noise
  let jerkAutocorr = 0;
  if (jerks.length > 20) {
    const jerkMean = jerks.reduce((a, b) => a + b, 0) / jerks.length;
    let autocorrNum = 0, autocorrDenom = 0;
    for (let i = 1; i < jerks.length; i++) {
      autocorrNum += (jerks[i] - jerkMean) * (jerks[i-1] - jerkMean);
    }
    for (let i = 0; i < jerks.length; i++) {
      autocorrDenom += Math.pow(jerks[i] - jerkMean, 2);
    }
    jerkAutocorr = autocorrDenom > 0 ? autocorrNum / autocorrDenom : 0;
  }

  // 18. Acceleration linearity (quadratic Bezier has LINEAR acceleration)
  // Check if acceleration changes linearly over segments
  let linearAccelSegments = 0;
  let totalAccelSegments = 0;
  const accelSegmentSize = 15;
  for (let start = 0; start < accelerations.length - accelSegmentSize; start += 10) {
    const segment = accelerations.slice(start, start + accelSegmentSize);
    const accelMags = segment.map(a => Math.sqrt(a.ax*a.ax + a.ay*a.ay));

    // Fit linear regression and check R²
    const n = accelMags.length;
    const sumX = n * (n - 1) / 2;
    const sumX2 = n * (n - 1) * (2 * n - 1) / 6;
    const sumY = accelMags.reduce((a, b) => a + b, 0);
    const sumXY = accelMags.reduce((sum, y, x) => sum + x * y, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    let ssRes = 0, ssTot = 0;
    const yMean = sumY / n;
    for (let i = 0; i < n; i++) {
      const predicted = intercept + slope * i;
      ssRes += Math.pow(accelMags[i] - predicted, 2);
      ssTot += Math.pow(accelMags[i] - yMean, 2);
    }
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    totalAccelSegments++;
    if (r2 > 0.85) linearAccelSegments++; // High R² = linear = Bezier-like
  }
  const linearAccelRatio = totalAccelSegments > 0 ? linearAccelSegments / totalAccelSegments : 0;

  // 19. Speed profile asymmetry - ease-in-out is symmetric, humans are asymmetric
  // Check if acceleration phase ≈ deceleration phase (symmetric = bot)
  let symmetricMovements = 0;
  let totalMovements = 0;

  // Find movement boundaries (velocity near zero)
  const movementStarts = [0];
  for (let i = 1; i < speedMagnitudes.length; i++) {
    if (speedMagnitudes[i-1] < 0.3 && speedMagnitudes[i] > 0.5) {
      movementStarts.push(i);
    }
  }
  movementStarts.push(speedMagnitudes.length);

  for (let m = 0; m < movementStarts.length - 1; m++) {
    const start = movementStarts[m];
    const end = movementStarts[m + 1];
    if (end - start < 10) continue;

    const segment = speedMagnitudes.slice(start, end);
    const peakIdx = segment.indexOf(Math.max(...segment));

    if (peakIdx > 2 && peakIdx < segment.length - 2) {
      const accelPhase = peakIdx;
      const decelPhase = segment.length - peakIdx;
      const ratio = Math.min(accelPhase, decelPhase) / Math.max(accelPhase, decelPhase);

      totalMovements++;
      if (ratio > 0.7) symmetricMovements++; // Symmetric = bot-like
    }
  }
  const symmetryRatio = totalMovements > 0 ? symmetricMovements / totalMovements : 0;

  // 20. X-Y noise correlation - bot applies independent noise to X and Y
  // Human tremor affects X and Y together (correlated)
  let xyNoiseCorr = 0;
  if (residuals.length > 10) {
    const meanX = residuals.reduce((s, r) => s + r.x, 0) / residuals.length;
    const meanY = residuals.reduce((s, r) => s + r.y, 0) / residuals.length;
    let covXY = 0, varX = 0, varY = 0;
    for (const r of residuals) {
      covXY += (r.x - meanX) * (r.y - meanY);
      varX += Math.pow(r.x - meanX, 2);
      varY += Math.pow(r.y - meanY, 2);
    }
    xyNoiseCorr = (varX > 0 && varY > 0) ? Math.abs(covXY / Math.sqrt(varX * varY)) : 0;
  }

  // 21. Movement initiation analysis - humans waver when starting, bots commit immediately
  // After a pause, humans show direction uncertainty; bots head straight to target
  let perfectStarts = 0;
  let totalStarts = 0;

  // Find movement starts (after pauses of 100ms+)
  for (let i = 1; i < points.length - 10; i++) {
    const gap = points[i].t - points[i-1].t;
    if (gap > 100) {
      // This is a movement start after a pause
      // Check if first 5 points head in consistent direction
      const initPoints = points.slice(i, i + 8);
      if (initPoints.length >= 8) {
        // Calculate direction of first segment and last segment of initial movement
        const dir1 = Math.atan2(initPoints[2].y - initPoints[0].y, initPoints[2].x - initPoints[0].x);
        const dir2 = Math.atan2(initPoints[7].y - initPoints[5].y, initPoints[7].x - initPoints[5].x);

        let dirDiff = Math.abs(dir1 - dir2);
        if (dirDiff > Math.PI) dirDiff = 2 * Math.PI - dirDiff;

        totalStarts++;
        // Bot: very consistent direction from start (< 20 degrees difference)
        if (dirDiff < 0.35) perfectStarts++;
      }
    }
  }
  const perfectStartRatio = totalStarts > 0 ? perfectStarts / totalStarts : 0;

  // 22. Initial acceleration pattern - humans have tentative start, bots accelerate smoothly
  // Check acceleration in first few points after pause
  let smoothAccelStarts = 0;
  let totalAccelStarts = 0;

  for (let i = 1; i < points.length - 8; i++) {
    const gap = points[i].t - points[i-1].t;
    if (gap > 100) {
      // Movement start - check if acceleration is monotonically increasing (bot-like)
      const initSpeeds = [];
      for (let j = i; j < i + 6 && j < points.length; j++) {
        const dt = points[j].t - points[j-1].t;
        if (dt > 0) {
          const dx = points[j].x - points[j-1].x;
          const dy = points[j].y - points[j-1].y;
          initSpeeds.push(Math.sqrt(dx*dx + dy*dy) / dt);
        }
      }

      if (initSpeeds.length >= 4) {
        totalAccelStarts++;
        // Check if speeds are monotonically increasing (smooth start = bot)
        let monotonic = true;
        for (let j = 1; j < initSpeeds.length; j++) {
          if (initSpeeds[j] < initSpeeds[j-1] * 0.9) { // Allow 10% tolerance
            monotonic = false;
            break;
          }
        }
        if (monotonic) smoothAccelStarts++;
      }
    }
  }
  const smoothStartRatio = totalAccelStarts > 0 ? smoothAccelStarts / totalAccelStarts : 0;

  // 23. Micro-movements during "thinking" - humans fidget, bots are still during delays
  // Check for tiny movements in low-speed periods
  let fidgetCount = 0;
  let stillPeriods = 0;

  for (let i = 5; i < speedMagnitudes.length - 5; i++) {
    const localSpeed = speedMagnitudes.slice(i-2, i+3).reduce((a,b) => a+b, 0) / 5;
    if (localSpeed < 0.2) { // Very slow period
      stillPeriods++;
      // Check for micro-movements (small but non-zero displacement)
      const microDist = Math.sqrt(
        Math.pow(points[i+2].x - points[i-2].x, 2) +
        Math.pow(points[i+2].y - points[i-2].y, 2)
      );
      if (microDist > 1 && microDist < 10) fidgetCount++;
    }
  }
  const fidgetRatio = stillPeriods > 0 ? fidgetCount / stillPeriods : 0;

  // Combined anti-Bezier check with signals for bot detection
  // Updated in v1.4.0 based on confusion matrix analysis
  // Key insight: reversalRatio and smoothRatio are STRONG differentiators
  const bezierSignals = [
    // Original signals (with adjusted thresholds)
    jerkSpikeRatio < 0.035,          // Too smooth jerk
    accelSignChangeRate < 0.35,      // Too few direction corrections
    curvatureChangeRate < 0.12,      // Too smooth curves
    velocityPeaksPerSecond < 2.0,    // Not enough sub-movements
    pathEfficiency > 0.75,           // Too efficient/direct path
    Math.abs(noiseAutocorr) < 0.08,  // Uncorrelated position noise (relaxed)
    directionEntropy < 1.4,          // Too predictable direction changes
    reversalRate < 0.02,             // No overshoot corrections
    // hesitationRate REMOVED - bots actually hesitate more than some humans!
    Math.abs(jerkAutocorr) < 0.12,   // Jerk is white noise (no temporal structure)
    linearAccelRatio > 0.3,          // Too many linear acceleration segments (Bezier)
    symmetryRatio > 0.6,             // Too symmetric velocity profiles (ease-in-out)
    xyNoiseCorr < 0.10,              // X-Y noise uncorrelated (relaxed)
    perfectStartRatio > 0.9,         // Too many perfect starts (relaxed - humans can be confident)
    smoothStartRatio > 0.6,          // Too many smooth acceleration starts
    fidgetRatio < 0.10,              // No fidgeting during pauses
    // NEW strong signals from confusion matrix analysis (v1.4.0)
    // These have HUGE gaps between humans and bots:
    reversalRatio > 0.15,            // HIGH reversal = BOT (bots: 0.29-0.61, humans: 0-0.01)
    smoothRatio < 0.45,              // LOW smooth = BOT (bots: 0.21-0.37, humans: 0.62-0.85)
    curvatureChangeRate > 0.55       // HIGH curvature change = BOT (bots: 0.72-0.79, humans: 0.23-0.41)
  ];
  const bezierSignalCount = bezierSignals.filter(Boolean).length;
  const isBezierLike = bezierSignalCount >= 3; // Fail if 3+ signals

  const isTimingTooRegular = timingCV < 0.12;

  checks.notRobotic = straightRatio < 0.5 && !isBezierLike && !isTimingTooRegular;

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
    detectionVersion: DETECTION_VERSION,
    detectionConfig: DETECTION_CONFIG,
    metrics: {
      speedVariation: speeds.length > 0 ? Math.max(...speeds) / Math.min(...speeds) : 0,
      smoothRatio,
      reversalRatio,
      continuousRatio,
      pointsPerSecond,
      straightRatio,
      // Anti-Bezier metrics
      jerkSpikeRatio,
      accelSignChangeRate,
      curvatureChangeRate,
      timingCV,
      velocityPeaksPerSecond,
      pathEfficiency,
      noiseAutocorr,
      directionEntropy,
      reversalRate,
      hesitationRate,
      // New metrics
      jerkAutocorr,
      linearAccelRatio,
      symmetryRatio,
      xyNoiseCorr,
      // Movement initiation metrics
      perfectStartRatio,
      smoothStartRatio,
      fidgetRatio,
      bezierSignalCount,
      isBezierLike,
      isTimingTooRegular,
      // v1.4.0: Signal trigger details for debugging
      triggeredSignals: bezierSignals.map((triggered, i) => triggered ? i : -1).filter(i => i >= 0)
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
