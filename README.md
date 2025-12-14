# AI Mouse Check

A browser-based human verification system that detects AI/bot mouse control by analyzing movement patterns. Designed to be easy for humans but difficult for programmatic mouse control.

## How It Works

The system analyzes mouse movements in real-time using 7 detection checks that identify characteristics of human movement that are difficult for AI to replicate:

- **Movement flow analysis** - Humans generate continuous mousemove events; AI moves in discrete jumps
- **Path curvature** - Humans create smooth curves; AI creates straight line segments between points
- **Timing patterns** - Humans have natural pauses and acceleration; AI has predictable timing
- **Physiological indicators** - Natural human tremor and micro-corrections
- **Target tracking** - Interactive challenge requiring purposeful mouse control

## Features

- Zero dependencies - pure vanilla JavaScript
- Works client-side only (no server required for basic use)
- Configurable timeout and thresholds
- Callback support for success/failure handling
- AI detection flagging
- Obscured check names to prevent AI learning

## Installation

### Via npm
```bash
npm install ai-mouse-check
```

### Via CDN
```html
<script src="https://unpkg.com/ai-mouse-check/ai-mouse-check.min.js"></script>
```

### Direct download
Copy `ai-mouse-check.js` to your project.

## Usage

### Basic Usage

```html
<script src="ai-mouse-check.js"></script>
<script>
  const checker = new AIMouseCheck({
    onSuccess: (result) => {
      console.log('Human verified!', result.signature);
    },
    onFailure: (result) => {
      console.log('Verification failed', result.reason);
      if (result.aiDetected) {
        console.log('AI detected!');
      }
    }
  });

  // Show the verification modal
  checker.verify();
</script>
```

### With Custom Options

```javascript
const checker = new AIMouseCheck({
  timeout: 10000,           // 10 seconds (default)
  targetHitsRequired: 5,    // Number of targets to hit (default: 5)
  container: document.body, // Where to append the modal
  onSuccess: (result) => {
    // result.signature - unique hash of the movement
    // result.checkssPassed - number of checks passed
    // result.duration - time taken in ms
  },
  onFailure: (result) => {
    // result.reason - 'timeout' | 'cancelled' | 'failed'
    // result.aiDetected - boolean
    // result.checksPassed - number of checks passed
  }
});
```

### Promise-based Usage

```javascript
try {
  const result = await checker.verifyAsync();
  console.log('Verified!', result);
} catch (failure) {
  console.log('Failed:', failure.reason);
}
```

## Detection Methodology

The system uses a "swiss cheese" model with multiple independent detection layers:

1. **Speed Variation** - Analyzes acceleration/deceleration patterns following Fitts's Law
2. **Path Curvature** - Measures angle changes between movement vectors
3. **Micro-movements** - Detects natural physiological tremor
4. **Timing Analysis** - Identifies human-like pauses and continuous movement
5. **Continuous Flow** - Measures point density and time gaps between events
6. **Straight Line Detection** - Fails if consecutive points form perfect lines
7. **Target Tracking** - Interactive challenge requiring purposeful control

An AI must pass ALL checks simultaneously within the time limit - failing any single check blocks verification.

## Why This Works

Programmatic mouse control (like browser automation tools) typically:
- Moves in straight lines between coordinates
- Has regular, predictable timing
- Lacks the continuous stream of events humans generate
- Cannot replicate natural hand tremor
- Shows "too perfect" movement patterns

Human mouse movement has inherent imperfection that's actually very difficult to fake convincingly.

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 11+
- Edge 79+

## License

MIT License - see [LICENSE](LICENSE)

## Author

[dshanklin-bv](https://github.com/dshanklin-bv)

## Contributing

Contributions welcome! Please read the contributing guidelines before submitting PRs.

## Security Note

This is a client-side detection system. For high-security applications, combine with server-side validation and additional verification methods.
