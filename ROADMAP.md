# AI Mouse Check - Roadmap

Future improvements to make the system harder for automation while keeping it client-side only.

## Harder Target Logic

- [ ] **Vary target size per hop** - Randomize between small/medium/large targets so bots can't optimize for fixed hitbox
- [ ] **Vary target shape** - Mix circles, squares, rounded rectangles
- [ ] **Decoy targets** - Add "no-op" targets (red/different icon) that should NOT be chased; forces classification, not just tracking
- [ ] **Randomize reaction time windows** - Vary min/max allowed reaction times per hop so bots can't fix a single delay profile

## Richer Trajectory Analysis

- [ ] **FFT/wavelet analysis** - Analyze frequency spectrum of movement; naive jitter or over-smoothing shows distinct signatures
- [ ] **Jerk distribution** - Track 2D acceleration derivative; cubic splines are "too smooth", synthetic noise is "too white"
- [ ] **Curvature spectrum** - Energy distribution across curvature bands, not just simple ratios

## Multiple Interaction Types

- [ ] **Click events** - Require clicks on targets, analyze press/release timing
- [ ] **Drag segments** - Short drag-and-drop challenges mixed in
- [ ] **Pause zones** - Highlighted regions where user must stop briefly
- [ ] **Inverted control mode** - Occasionally flip cursor direction; humans adapt quickly, scripts need explicit logic

## Environment Hardening

- [ ] **Pointer type detection** - Check if using mouse vs touch vs pen
- [ ] **Pointer acceleration** - Detect if system acceleration is disabled (common in automation)
- [ ] **devicePixelRatio checks** - Flag unusual values common in headless browsers
- [ ] **Focus/blur events** - Track window focus patterns during verification
- [ ] **Headless detection** - navigator.webdriver, missing plugins, etc.

## Anti-Reverse-Engineering

- [ ] **Closure-based state** - Hide targetX/Y in closures instead of object properties
- [ ] **Randomize sampling windows** - Don't use fixed 300-point, fixed-interval spec
- [ ] **Randomize check order** - Vary which checks run and in what sequence
- [ ] **Obfuscate feature names** - Make it harder to map code to detection logic

## Contributing

PRs welcome for any of these improvements. The goal is making it progressively harder for automation while keeping the UX smooth for humans.
