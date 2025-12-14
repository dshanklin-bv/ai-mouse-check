/**
 * AI Mouse Check - Human verification through mouse movement analysis
 * https://github.com/dshanklin-bv/ai-mouse-check
 * MIT License
 */
console.log('ai-mouse-check.js loading...');

(function(global) {
  'use strict';
  console.log('AIMouseCheck IIFE executing');

  class AIMouseCheck {
    constructor(options = {}) {
      this.options = {
        timeout: options.timeout || 10000,
        targetHitsRequired: options.targetHitsRequired || 5,
        container: options.container || document.body,
        onSuccess: options.onSuccess || (() => {}),
        onFailure: options.onFailure || (() => {}),
        onTargetHit: options.onTargetHit || null,
        theme: options.theme || 'dark'
      };

      this.state = {
        movementData: [],
        targetHits: 0,
        reactionTimes: [],
        targetX: 0,
        targetY: 0,
        targetMoveTime: 0,
        isCapturing: false,
        startTime: 0,
        checkInterval: null,
        timeoutId: null,
        modal: null,
        resolve: null,
        reject: null
      };
    }

    verify() {
      this._createModal();
      this._showModal();
    }

    verifyAsync() {
      return new Promise((resolve, reject) => {
        this.state.resolve = resolve;
        this.state.reject = reject;
        this.verify();
      });
    }

    _createModal() {
      const theme = this.options.theme === 'dark' ? {
        bg: '#1a1a2e',
        bgSecondary: '#16213e',
        text: '#eee',
        textMuted: '#888',
        accent: '#4cc9f0',
        success: '#06d6a0',
        danger: '#ef476f',
        border: '#333'
      } : {
        bg: '#ffffff',
        bgSecondary: '#f5f5f5',
        text: '#333',
        textMuted: '#666',
        accent: '#0077b6',
        success: '#06d6a0',
        danger: '#ef476f',
        border: '#ddd'
      };

      const modal = document.createElement('div');
      modal.className = 'ai-mouse-check-modal';
      modal.innerHTML = `
        <style>
          .ai-mouse-check-modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          }
          .ai-mouse-check-content {
            background: ${theme.bg};
            border-radius: 16px;
            width: 90vw;
            max-width: 900px;
            height: 70vh;
            max-height: 600px;
            display: flex;
            flex-direction: column;
            color: ${theme.text};
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
          }
          .ai-mouse-check-header {
            padding: 16px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid ${theme.border};
          }
          .ai-mouse-check-title {
            margin: 0;
            font-size: 20px;
          }
          .ai-mouse-check-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: ${theme.textMuted};
            padding: 0;
            width: 32px;
            height: 32px;
          }
          .ai-mouse-check-close:hover {
            color: ${theme.text};
          }
          .ai-mouse-check-body {
            flex: 1;
            padding: 20px;
            display: flex;
            flex-direction: column;
            text-align: center;
          }
          .ai-mouse-check-area {
            flex: 1;
            background: ${theme.bgSecondary};
            border-radius: 12px;
            position: relative;
            cursor: crosshair;
            overflow: hidden;
            border: 2px solid ${theme.border};
          }
          .ai-mouse-check-target {
            position: absolute;
            width: 60px;
            height: 60px;
            background: ${theme.success};
            border-radius: 50%;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            transition: left 0.3s ease-out, top 0.3s ease-out;
            pointer-events: none;
            box-shadow: 0 0 20px rgba(6, 214, 160, 0.3);
          }
          .ai-mouse-check-prompt {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: ${theme.textMuted};
            text-align: center;
          }
          .ai-mouse-check-checks {
            margin-top: 16px;
            display: flex;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
          }
          .ai-mouse-check-check {
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            background: ${theme.bgSecondary};
            color: ${theme.textMuted};
          }
          .ai-mouse-check-check.passed {
            background: ${theme.success};
            color: #fff;
          }
          .ai-mouse-check-status {
            margin-top: 12px;
            font-size: 13px;
            min-height: 20px;
            color: ${theme.accent};
          }
          .ai-mouse-check-path {
            fill: none;
            stroke: ${theme.accent};
            stroke-width: 2;
            stroke-linecap: round;
            stroke-linejoin: round;
            opacity: 0.6;
          }
          .ai-mouse-check-timer {
            position: absolute;
            top: 10px;
            left: 10px;
            font-size: 14px;
            font-family: monospace;
            color: ${theme.textMuted};
          }
          .ai-mouse-check-reaction {
            position: absolute;
            top: 10px;
            right: 10px;
            font-size: 12px;
            font-family: monospace;
            color: ${theme.textMuted};
          }
        </style>
        <div class="ai-mouse-check-content">
          <div class="ai-mouse-check-header">
            <h3 class="ai-mouse-check-title">Human Verification</h3>
            <button class="ai-mouse-check-close">&times;</button>
          </div>
          <div class="ai-mouse-check-body">
            <p style="color: ${theme.textMuted}; margin-bottom: 12px;">
              Move your mouse in the box below
            </p>
            <div class="ai-mouse-check-area">
              <svg width="100%" height="100%" style="position: absolute; top: 0; left: 0;">
                <path class="ai-mouse-check-path" d=""></path>
              </svg>
              <div class="ai-mouse-check-target">&#10003;</div>
              <div class="ai-mouse-check-prompt">
                <div style="font-size: 18px; margin-bottom: 8px;">Move mouse here to start</div>
              </div>
              <div class="ai-mouse-check-timer"></div>
              <div class="ai-mouse-check-reaction"></div>
            </div>
            <div class="ai-mouse-check-checks">
              <span class="ai-mouse-check-check" data-check="1">Check 1</span>
              <span class="ai-mouse-check-check" data-check="2">Check 2</span>
              <span class="ai-mouse-check-check" data-check="3">Check 3</span>
              <span class="ai-mouse-check-check" data-check="4">Check 4</span>
              <span class="ai-mouse-check-check" data-check="5">Check 5</span>
              <span class="ai-mouse-check-check" data-check="6">Check 6</span>
              <span class="ai-mouse-check-check" data-check="7">Check 7 (0/${this.options.targetHitsRequired})</span>
            </div>
            <div class="ai-mouse-check-status"></div>
          </div>
        </div>
      `;

      this.state.modal = modal;
      this.options.container.appendChild(modal);

      // Bind events
      modal.querySelector('.ai-mouse-check-close').onclick = () => this._handleFailure('cancelled');
    }

    _showModal() {
      const modal = this.state.modal;
      const area = modal.querySelector('.ai-mouse-check-area');
      const pathEl = modal.querySelector('.ai-mouse-check-path');
      const targetEl = modal.querySelector('.ai-mouse-check-target');
      const promptEl = modal.querySelector('.ai-mouse-check-prompt');
      const statusEl = modal.querySelector('.ai-mouse-check-status');
      const timerEl = modal.querySelector('.ai-mouse-check-timer');
      const reactionEl = modal.querySelector('.ai-mouse-check-reaction');

      // Reset state
      this.state.movementData = [];
      this.state.targetHits = 0;
      this.state.reactionTimes = [];
      this.state.isCapturing = false;
      this.state.startTime = Date.now();

      // Reset UI
      pathEl.setAttribute('d', '');
      this._resetChecks();

      // Start timeout
      this.state.timeoutId = setTimeout(() => {
        this._handleFailure('timeout');
      }, this.options.timeout);

      // Update timer display
      const timerInterval = setInterval(() => {
        const elapsed = Date.now() - this.state.startTime;
        const remaining = Math.max(0, Math.ceil((this.options.timeout - elapsed) / 1000));
        timerEl.textContent = `${remaining}s`;
        if (remaining <= 0) clearInterval(timerInterval);
      }, 100);

      const moveTarget = () => {
        const rect = area.getBoundingClientRect();
        const margin = 80;
        this.state.targetX = margin + Math.random() * (rect.width - margin * 2);
        this.state.targetY = margin + Math.random() * (rect.height - margin * 2);
        targetEl.style.left = (this.state.targetX - 30) + 'px';
        targetEl.style.top = (this.state.targetY - 30) + 'px';
        this.state.targetMoveTime = Date.now();
      };

      area.onmouseenter = () => {
        this.state.isCapturing = true;
        promptEl.style.display = 'none';
        targetEl.style.display = 'flex';
        statusEl.textContent = `Hit the target ${this.options.targetHitsRequired} times!`;
        moveTarget();
      };

      area.onmouseleave = () => {
        this.state.isCapturing = false;
      };

      area.onmousemove = (e) => {
        if (!this.state.isCapturing) return;

        const rect = area.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.state.movementData.push({ x, y, t: Date.now() });

        // Check target hit
        const dist = Math.sqrt(
          Math.pow(x - this.state.targetX, 2) +
          Math.pow(y - this.state.targetY, 2)
        );

        if (dist < 40 && this.state.targetMoveTime > 0) {
          const reactionTime = Date.now() - this.state.targetMoveTime;
          if (reactionTime > 150) {
            this.state.reactionTimes.push(reactionTime);
            this.state.targetHits++;
            reactionEl.textContent = `Hits: ${this.state.targetHits}/${this.options.targetHitsRequired}`;

            // Call onTargetHit callback if provided
            console.log('Target hit!', this.state.targetHits, 'callback:', !!this.options.onTargetHit);
            if (this.options.onTargetHit) {
              try {
                this.options.onTargetHit(
                  this.state.targetHits,
                  this.options.targetHitsRequired,
                  [...this.state.movementData]
                );
              } catch (e) {
                console.error('onTargetHit callback error:', e);
              }
            }

            moveTarget();
          }
        }

        // Draw path
        if (this.state.movementData.length > 300) {
          this.state.movementData = this.state.movementData.slice(-300);
        }

        if (this.state.movementData.length > 1) {
          let d = `M ${this.state.movementData[0].x} ${this.state.movementData[0].y}`;
          for (let i = 1; i < this.state.movementData.length; i++) {
            d += ` L ${this.state.movementData[i].x} ${this.state.movementData[i].y}`;
          }
          pathEl.setAttribute('d', d);
        }
      };

      // Check conditions periodically
      this.state.checkInterval = setInterval(() => {
        if (this.state.movementData.length < 10) return;

        const checks = this._analyzeMovement();
        this._updateChecks(checks);

        // All passed?
        const allPassed = checks.speed && checks.curves && checks.jitter &&
                          checks.timing && checks.continuous && checks.notRobotic &&
                          this.state.targetHits >= this.options.targetHitsRequired;

        if (allPassed) {
          this._handleSuccess(checks);
        }
      }, 100);
    }

    _analyzeMovement() {
      const points = this.state.movementData;
      const checks = {
        speed: false, curves: false, jitter: false,
        timing: false, continuous: false, notRobotic: true
      };

      if (points.length < 15) return checks;

      // 1. Speed variation (Fitts's Law)
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

      // 3. Micro-movements (jitter)
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

      // 4. Timing
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
      // Measure how much actual path deviates from best-fit line

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
        // Only flag as too straight if deviation is < 0.5% AND < 2px absolute
        if (deviationRatio < 0.005 && avgDeviation < 2) {
          tooStraightSegments++;
        }
      }

      const straightRatio = totalSegments > 0 ? tooStraightSegments / totalSegments : 0;
      checks.notRobotic = straightRatio < 0.5;

      return checks;
    }

    _updateChecks(checks) {
      const checkEls = this.state.modal.querySelectorAll('.ai-mouse-check-check');
      const values = [checks.speed, checks.curves, checks.jitter, checks.timing, checks.continuous, checks.notRobotic];

      values.forEach((passed, i) => {
        if (checkEls[i]) {
          checkEls[i].classList.toggle('passed', passed);
          checkEls[i].textContent = `Check ${i + 1}`;
        }
      });

      // Update target check
      const targetEl = checkEls[6];
      if (targetEl) {
        const passed = this.state.targetHits >= this.options.targetHitsRequired;
        targetEl.classList.toggle('passed', passed);
        targetEl.textContent = `Check 7 (${this.state.targetHits}/${this.options.targetHitsRequired})`;
      }
    }

    _resetChecks() {
      const checkEls = this.state.modal.querySelectorAll('.ai-mouse-check-check');
      checkEls.forEach((el, i) => {
        el.classList.remove('passed');
        if (i < 6) {
          el.textContent = `Check ${i + 1}`;
        } else {
          el.textContent = `Check 7 (0/${this.options.targetHitsRequired})`;
        }
      });
    }

    _handleSuccess(checks) {
      this._cleanup();

      // Generate signature
      const hash = this._generateHash(JSON.stringify(this.state.movementData));
      const duration = Date.now() - this.state.startTime;

      const result = {
        verified: true,
        signature: hash,
        checksPassed: 7,
        duration,
        targetHits: this.state.targetHits,
        movementData: this.state.movementData.slice()
      };

      const statusEl = this.state.modal.querySelector('.ai-mouse-check-status');
      statusEl.innerHTML = `<span style="color: #06d6a0;">&#10003; Verified!</span>`;

      setTimeout(() => {
        this._closeModal();
        this.options.onSuccess(result);
        if (this.state.resolve) this.state.resolve(result);
      }, 1000);
    }

    _handleFailure(reason) {
      this._cleanup();

      const checks = this._analyzeMovement();
      const aiFailures = [!checks.curves, !checks.continuous, !checks.notRobotic, !checks.timing].filter(Boolean).length;
      const aiDetected = aiFailures >= 2;
      const checksPassed = [checks.speed, checks.curves, checks.jitter, checks.timing, checks.continuous, checks.notRobotic].filter(Boolean).length +
                           (this.state.targetHits >= this.options.targetHitsRequired ? 1 : 0);

      const result = {
        verified: false,
        reason,
        aiDetected,
        checksPassed,
        duration: Date.now() - this.state.startTime,
        movementData: this.state.movementData.slice()
      };

      const statusEl = this.state.modal.querySelector('.ai-mouse-check-status');
      statusEl.innerHTML = `<span style="color: #ef476f;">&#10007; Failed${aiDetected ? ' - AI detected' : ''}</span>`;

      setTimeout(() => {
        this._closeModal();
        this.options.onFailure(result);
        if (this.state.reject) this.state.reject(result);
      }, 1500);
    }

    _cleanup() {
      if (this.state.checkInterval) {
        clearInterval(this.state.checkInterval);
        this.state.checkInterval = null;
      }
      if (this.state.timeoutId) {
        clearTimeout(this.state.timeoutId);
        this.state.timeoutId = null;
      }
    }

    _closeModal() {
      if (this.state.modal && this.state.modal.parentNode) {
        this.state.modal.parentNode.removeChild(this.state.modal);
      }
      this.state.modal = null;
    }

    _generateHash(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash).toString(16).padStart(8, '0') +
             Date.now().toString(16) +
             Math.random().toString(16).slice(2, 10);
    }
  }

  // Export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AIMouseCheck;
  } else {
    global.AIMouseCheck = AIMouseCheck;
  }

})(typeof window !== 'undefined' ? window : this);
