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
const { analyzeMovement, generateSignature, verifySignature } = require('./detection');

const app = express();
const PORT = process.env.PORT || 3847;

// Secret key for signing (in production, use environment variable)
const SECRET_KEY = process.env.VERIFICATION_SECRET || 'change-this-in-production-' + Math.random().toString(36);

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..')));

// Store verified sessions (in production, use Redis or database)
const verifiedSessions = new Map();

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
