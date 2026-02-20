# Shoter 2D

A fast-paced 2D arcade shooter game playable on desktop and mobile devices.

## How to Play

### Desktop Controls
- **WASD** or **Arrow Keys**: Move player
- **Mouse**: Aim
- **Left Mouse Button** or **Space**: Shoot
- **Shift**: Dash (3x speed, invulnerable during dash)
- **P** or **Esc**: Pause/Unpause
- **R**: Restart game
- **M**: Mute/Unmute sound
- **~** (Tilde): Toggle debug mode

### Mobile Controls (Touch)
- **Left Thumb (Left Half of Screen)**: Virtual joystick for movement
  - Touch and drag on the left side to move
  - Joystick appears where you first touch
- **Right Thumb (Right Half of Screen)**: Aim and auto-fire
  - Touch on the right side to aim at that position
  - Hold to continuously shoot
  - Drag to aim while shooting
- **DASH Button** (Bottom Right): Activate dash ability
- **PAUSE Button** (Top Right): Pause/Unpause game
- **MUTE Button** (Top Left): Toggle sound on/off

## Features

- **Combo System**: Chain kills for score multipliers
- **Wave System**: Increasing difficulty with each wave
- **Dash Ability**: Quick escape with invulnerability frames
- **Screen Shake**: Impact feedback on hits and kills
- **Hitstop**: Micro-freeze on impacts for satisfying feel
- **Particle Effects**: Visual feedback on enemy deaths
- **Shockwaves**: Ring expansion on enemy kills
- **Mobile Optimized**: Touch controls, performance tuned for phones

## Performance

- Optimized for 60 FPS on both desktop and mobile
- Dynamic particle limits based on device
- Sound spam limiting to prevent audio overload
- Efficient rendering with object pooling

## Browser Compatibility

Works in all modern browsers that support:
- HTML5 Canvas
- WebAudio API
- Touch Events (mobile)

## Tips

- Use dash to escape tight situations
- Build combos for higher scores
- Aim ahead of moving enemies
- Dash makes you invulnerable - use it strategically!
