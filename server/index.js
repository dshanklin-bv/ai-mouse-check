/**
 * AI Mouse Check - Server-side verification server
 *
 * This server receives raw movement data and runs the SAME detection
 * algorithms server-side, making verification tamper-proof.
 *
 * Usage:
 *   npm run server
 *   # Server runs on http://localhost:3847
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { analyzeMovement, generateSignature, verifySignature } = require('./detection');

const MATRIX_FILE = path.join(__dirname, '..', 'confusion-matrix.json');
const MOVEMENTS_DIR = path.join(__dirname, '..', 'movements');

// Ensure movements directory exists
if (!fs.existsSync(MOVEMENTS_DIR)) {
  fs.mkdirSync(MOVEMENTS_DIR, { recursive: true });
}

/**
 * Save movement data to a file
 * @param {string} id - Unique identifier for this movement session
 * @param {object} data - Movement data including points, isHuman, passed, etc.
 */
function saveMovement(id, data) {
  const filename = path.join(MOVEMENTS_DIR, `${id}.json`);
  try {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving movement:', e);
    return false;
  }
}

const app = express();
const PORT = process.env.PORT || 3847;

// Secret key for signing (in production, use environment variable)
const SECRET_KEY = process.env.VERIFICATION_SECRET || 'change-this-in-production-' + Math.random().toString(36);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Disable caching for JS files during development
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname, '..')));

// Store verified sessions (in production, use Redis or database)
const verifiedSessions = new Map();

// Confusion matrix tracking - load from file or initialize
function loadConfusionMatrix() {
  try {
    if (fs.existsSync(MATRIX_FILE)) {
      const data = fs.readFileSync(MATRIX_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading confusion matrix:', e);
  }
  return {
    humanPassed: 0,
    humanFailed: 0,
    botPassed: 0,
    botFailed: 0,
    humanResults: [],
    botResults: []
  };
}

function saveConfusionMatrix() {
  try {
    fs.writeFileSync(MATRIX_FILE, JSON.stringify(confusionMatrix, null, 2));
  } catch (e) {
    console.error('Error saving confusion matrix:', e);
  }
}

const confusionMatrix = loadConfusionMatrix();
console.log('Loaded confusion matrix:', {
  humanPassed: confusionMatrix.humanPassed,
  humanFailed: confusionMatrix.humanFailed,
  botPassed: confusionMatrix.botPassed,
  botFailed: confusionMatrix.botFailed
});

/**
 * POST /api/verify
 * Verify mouse movement data server-side
 *
 * Request body:
 *   - points: Array of {x, y, t} movement points
 *   - targetHits: Number of targets hit
 *   - recordId: Optional ID to associate with verification
 *
 * Response:
 *   - verified: boolean
 *   - signature: string (if verified)
 *   - checks: object with individual check results
 *   - aiDetected: boolean
 */
app.post('/api/verify', (req, res) => {
  try {
    const { points, targetHits, recordId } = req.body;

    if (!points || !Array.isArray(points)) {
      return res.status(400).json({
        error: 'Missing or invalid points array'
      });
    }

    // Run server-side detection (same algorithms as client)
    const result = analyzeMovement(points, {
      targetHits: targetHits || 0,
      targetHitsRequired: 5
    });

    // If verified, generate cryptographic signature
    if (result.verified) {
      const sigData = generateSignature(SECRET_KEY, {
        points,
        recordId: recordId || 'anonymous',
        checksPassed: result.checksPassed
      });

      // Store session for later verification
      const sessionId = sigData.signature.slice(0, 16);
      verifiedSessions.set(sessionId, {
        signature: sigData.signature,
        timestamp: sigData.timestamp,
        recordId,
        expiresAt: Date.now() + 3600000 // 1 hour
      });

      // Clean expired sessions
      for (const [key, value] of verifiedSessions) {
        if (value.expiresAt < Date.now()) {
          verifiedSessions.delete(key);
        }
      }

      return res.json({
        verified: true,
        signature: sigData.signature,
        sessionId,
        timestamp: sigData.timestamp,
        checks: result.checks,
        checksPassed: result.checksPassed,
        metrics: result.metrics
      });
    }

    // Not verified
    return res.json({
      verified: false,
      aiDetected: result.aiDetected,
      checks: result.checks,
      checksPassed: result.checksPassed,
      reason: result.reason || 'checks_failed',
      metrics: result.metrics
    });

  } catch (error) {
    console.error('Verification error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * POST /api/verify-signature
 * Verify a previously issued signature
 */
app.post('/api/verify-signature', (req, res) => {
  try {
    const { sessionId, signature } = req.body;

    if (!sessionId || !signature) {
      return res.status(400).json({
        error: 'Missing sessionId or signature'
      });
    }

    const session = verifiedSessions.get(sessionId);

    if (!session) {
      return res.json({
        valid: false,
        reason: 'session_not_found'
      });
    }

    if (session.expiresAt < Date.now()) {
      verifiedSessions.delete(sessionId);
      return res.json({
        valid: false,
        reason: 'session_expired'
      });
    }

    const valid = session.signature === signature;

    return res.json({
      valid,
      recordId: valid ? session.recordId : null,
      timestamp: valid ? session.timestamp : null
    });

  } catch (error) {
    console.error('Signature verification error:', error);
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    serverSideVerification: true,
    activeSessions: verifiedSessions.size
  });
});

/**
 * POST /api/record-result
 * Record a test result for confusion matrix tracking
 *
 * Request body:
 *   - isHuman: boolean (true if this was a human test, false if bot)
 *   - passed: boolean (true if the test passed verification)
 *   - points: array of {x, y, t} movement points (optional but recommended)
 *   - metrics: object (optional metrics for analysis)
 */
app.post('/api/record-result', (req, res) => {
  try {
    const { isHuman, passed, points, metrics, detectionVersion, detectionConfig } = req.body;

    if (typeof isHuman !== 'boolean' || typeof passed !== 'boolean') {
      return res.status(400).json({
        error: 'Missing required fields: isHuman and passed (both boolean)'
      });
    }

    const timestamp = Date.now();
    const movementId = `${isHuman ? 'human' : 'bot'}_${passed ? 'pass' : 'fail'}_${timestamp}`;

    const record = {
      timestamp,
      passed,
      movementId,
      detectionVersion: detectionVersion || 'unknown',
      detectionConfig: detectionConfig || null,
      metrics: metrics || {},
      pointCount: points ? points.length : 0
    };

    // Save movement data to separate file if provided
    if (points && Array.isArray(points) && points.length > 0) {
      saveMovement(movementId, {
        id: movementId,
        isHuman,
        passed,
        timestamp,
        detectionVersion: detectionVersion || 'unknown',
        detectionConfig: detectionConfig || null,
        metrics: metrics || {},
        points
      });
    }

    if (isHuman) {
      if (passed) {
        confusionMatrix.humanPassed++;
      } else {
        confusionMatrix.humanFailed++;
      }
      confusionMatrix.humanResults.push(record);
      // Keep only last 100 records
      if (confusionMatrix.humanResults.length > 100) {
        confusionMatrix.humanResults.shift();
      }
    } else {
      if (passed) {
        confusionMatrix.botPassed++;
      } else {
        confusionMatrix.botFailed++;
      }
      confusionMatrix.botResults.push(record);
      if (confusionMatrix.botResults.length > 100) {
        confusionMatrix.botResults.shift();
      }
    }

    // Save to file
    saveConfusionMatrix();

    return res.json({
      success: true,
      matrix: {
        humanPassed: confusionMatrix.humanPassed,
        humanFailed: confusionMatrix.humanFailed,
        botPassed: confusionMatrix.botPassed,
        botFailed: confusionMatrix.botFailed
      }
    });

  } catch (error) {
    console.error('Record result error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/confusion-matrix
 * Get the current confusion matrix
 */
app.get('/api/confusion-matrix', (req, res) => {
  const { humanPassed, humanFailed, botPassed, botFailed } = confusionMatrix;

  const totalHuman = humanPassed + humanFailed;
  const totalBot = botPassed + botFailed;

  // Calculate rates
  const humanPassRate = totalHuman > 0 ? (humanPassed / totalHuman * 100).toFixed(1) : 'N/A';
  const botDetectionRate = totalBot > 0 ? (botFailed / totalBot * 100).toFixed(1) : 'N/A';
  const falsePositiveRate = totalHuman > 0 ? (humanFailed / totalHuman * 100).toFixed(1) : 'N/A';
  const falseNegativeRate = totalBot > 0 ? (botPassed / totalBot * 100).toFixed(1) : 'N/A';

  res.json({
    matrix: {
      humanPassed,      // True Negative
      humanFailed,      // False Positive
      botPassed,        // False Negative
      botFailed         // True Positive
    },
    totals: {
      human: totalHuman,
      bot: totalBot
    },
    rates: {
      humanPassRate: humanPassRate + '%',
      botDetectionRate: botDetectionRate + '%',
      falsePositiveRate: falsePositiveRate + '%',
      falseNegativeRate: falseNegativeRate + '%'
    },
    recentHuman: confusionMatrix.humanResults.slice(-10),
    recentBot: confusionMatrix.botResults.slice(-10)
  });
});

/**
 * POST /api/reset-matrix
 * Reset the confusion matrix
 */
app.post('/api/reset-matrix', (req, res) => {
  confusionMatrix.humanPassed = 0;
  confusionMatrix.humanFailed = 0;
  confusionMatrix.botPassed = 0;
  confusionMatrix.botFailed = 0;
  confusionMatrix.humanResults = [];
  confusionMatrix.botResults = [];

  saveConfusionMatrix();
  res.json({ success: true, message: 'Confusion matrix reset' });
});

/**
 * GET /api/movements
 * List all recorded movement sessions
 *
 * Query params:
 *   - type: 'human', 'bot', or 'all' (default: 'all')
 *   - result: 'pass', 'fail', or 'all' (default: 'all')
 */
app.get('/api/movements', (req, res) => {
  try {
    const { type = 'all', result = 'all' } = req.query;

    const files = fs.readdirSync(MOVEMENTS_DIR)
      .filter(f => f.endsWith('.json'))
      .filter(f => {
        if (type !== 'all') {
          const isHuman = f.startsWith('human_');
          if (type === 'human' && !isHuman) return false;
          if (type === 'bot' && isHuman) return false;
        }
        if (result !== 'all') {
          const passed = f.includes('_pass_');
          if (result === 'pass' && !passed) return false;
          if (result === 'fail' && passed) return false;
        }
        return true;
      })
      .sort()
      .reverse(); // Most recent first

    const movements = files.map(f => {
      const id = f.replace('.json', '');
      const parts = id.split('_');
      return {
        id,
        isHuman: parts[0] === 'human',
        passed: parts[1] === 'pass',
        timestamp: parseInt(parts[2], 10)
      };
    });

    res.json({
      count: movements.length,
      movements
    });
  } catch (error) {
    console.error('List movements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/movements/:id
 * Get a specific movement session with full point data
 */
app.get('/api/movements/:id', (req, res) => {
  try {
    const { id } = req.params;
    const filename = path.join(MOVEMENTS_DIR, `${id}.json`);

    if (!fs.existsSync(filename)) {
      return res.status(404).json({ error: 'Movement not found' });
    }

    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    res.json(data);
  } catch (error) {
    console.error('Get movement error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/movements
 * Delete all movement files (called with reset-matrix optionally)
 */
app.delete('/api/movements', (req, res) => {
  try {
    const files = fs.readdirSync(MOVEMENTS_DIR).filter(f => f.endsWith('.json'));
    files.forEach(f => fs.unlinkSync(path.join(MOVEMENTS_DIR, f)));
    res.json({ success: true, deleted: files.length });
  } catch (error) {
    console.error('Delete movements error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// ANALYSES ENDPOINTS
// ============================================

const ANALYSES_FILE = path.join(__dirname, '..', 'analyses.json');

function loadAnalyses() {
  try {
    if (fs.existsSync(ANALYSES_FILE)) {
      return JSON.parse(fs.readFileSync(ANALYSES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading analyses:', e);
  }
  return { analyses: [] };
}

function saveAnalyses(data) {
  try {
    fs.writeFileSync(ANALYSES_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error('Error saving analyses:', e);
    return false;
  }
}

/**
 * GET /api/analyses
 * Get all analyses (most recent first)
 */
app.get('/api/analyses', (req, res) => {
  const data = loadAnalyses();
  const sorted = [...data.analyses].sort((a, b) => b.version - a.version);
  res.json({
    count: sorted.length,
    latest: sorted[0] || null,
    analyses: sorted
  });
});

/**
 * GET /api/analyses/:version
 * Get a specific analysis by version
 */
app.get('/api/analyses/:version', (req, res) => {
  const version = parseInt(req.params.version, 10);
  const data = loadAnalyses();
  const analysis = data.analyses.find(a => a.version === version);
  if (!analysis) {
    return res.status(404).json({ error: 'Analysis not found' });
  }
  res.json(analysis);
});

/**
 * POST /api/analyses
 * Create a new analysis from current confusion matrix data
 */
app.post('/api/analyses', (req, res) => {
  try {
    const { keyFindings, changes, metricComparison, expectedImprovement, detectionVersion } = req.body;

    if (!keyFindings || !changes) {
      return res.status(400).json({ error: 'keyFindings and changes are required' });
    }

    const data = loadAnalyses();
    const nextVersion = data.analyses.length > 0
      ? Math.max(...data.analyses.map(a => a.version)) + 1
      : 1;

    const { humanPassed, humanFailed, botPassed, botFailed } = confusionMatrix;
    const totalHuman = humanPassed + humanFailed;
    const totalBot = botPassed + botFailed;

    const newAnalysis = {
      version: nextVersion,
      timestamp: Date.now(),
      detectionVersion: detectionVersion || 'unknown',
      dataRange: {
        humanTests: totalHuman,
        botTests: totalBot,
        humanPassed,
        humanFailed,
        botPassed,
        botFailed
      },
      performance: {
        humanPassRate: totalHuman > 0 ? (humanPassed / totalHuman * 100).toFixed(1) + '%' : 'N/A',
        botDetectionRate: totalBot > 0 ? (botFailed / totalBot * 100).toFixed(1) + '%' : 'N/A',
        falsePositiveRate: totalHuman > 0 ? (humanFailed / totalHuman * 100).toFixed(1) + '%' : 'N/A',
        falseNegativeRate: totalBot > 0 ? (botPassed / totalBot * 100).toFixed(1) + '%' : 'N/A'
      },
      keyFindings,
      changes,
      metricComparison: metricComparison || {},
      expectedImprovement: expectedImprovement || ''
    };

    data.analyses.push(newAnalysis);
    saveAnalyses(data);

    res.json({ success: true, analysis: newAnalysis });
  } catch (error) {
    console.error('Create analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║           AI Mouse Check - Verification Server            ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                 ║
║  Demo page: http://localhost:${PORT}/index.html              ║
║                                                           ║
║  Endpoints:                                               ║
║    POST /api/verify          - Verify movement data       ║
║    POST /api/verify-signature - Verify a signature        ║
║    GET  /api/health          - Health check               ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
