// How to run: Open index.html directly in a web browser. No server required.
// Desktop: WASD/Arrows = move, Mouse = aim, LMB/Space = shoot, Shift = dash, P/Esc = pause, R = restart, M = mute, ~ = debug
// Mobile: Left thumb = joystick move, Right thumb = aim+shoot, Dash button, Pause/Mute buttons

(function() {
    'use strict';

    // Canvas setup
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    const ctx = canvas.getContext('2d');
    let dpr = window.devicePixelRatio || 1;
    let vignetteGradient = null;

    const PERF = {
        maxEnemies: { desktop: 42, mobile: 24 },
        maxParticles: { desktop: 260, mobile: 150 },
        maxBullets: { desktop: 220, mobile: 140 },
        maxEnemyBullets: { desktop: 90, mobile: 45 },
        maxPickups: { desktop: 18, mobile: 12 },
        maxFloaters: { desktop: 40, mobile: 20 }
    };

    const WEAPONS = {
        pistol: { name: 'Pistol', damage: 10, fireRate: 0.18, speed: 700, spread: 0.02, pellets: 1, color: '#ffaa00', sfx: 'shoot' },
        shotgun: { name: 'Shotgun', damage: 5, fireRate: 0.6, speed: 650, spread: 0.18, pellets: 5, color: '#ffcc55', sfx: 'shotgun' },
        laser: { name: 'Laser', damage: 4, fireRate: 0.06, speed: 0, spread: 0, pellets: 1, color: '#66ddff', sfx: 'laser', heatPerShot: 0.08, coolRate: 0.35, overheat: 1, resume: 0.5, range: 420 },
        rocket: { name: 'Rocket', damage: 18, fireRate: 0.9, speed: 420, spread: 0.03, pellets: 1, color: '#ff8844', sfx: 'rocket', splash: 55 }
    };

    const PICKUP_TYPES = {
        rapid: { name: 'Rapid', color: '#66ff99', duration: 8 },
        shield: { name: 'Shield', color: '#66ccff', duration: 10 },
        damage: { name: 'Damage', color: '#ff9966', duration: 10 },
        health: { name: 'Health', color: '#66ff66', duration: 0 },
        weapon: { name: 'Weapon', color: '#ffcc66', duration: 10 }
    };

    const ENEMY_TYPES = {
        grunt: { hp: 1, speed: 90, radius: 14, damage: 10, color: '#ff4444', flash: '#ffffff' },
        runner: { hp: 1, speed: 150, radius: 10, damage: 8, color: '#ff66cc', flash: '#ffe6ff' },
        tank: { hp: 4, speed: 55, radius: 20, damage: 18, color: '#cc6666', flash: '#ffd6d6' },
        shooter: { hp: 2, speed: 75, radius: 13, damage: 10, color: '#ff8844', flash: '#fff1dd' },
        swarm: { hp: 1, speed: 120, radius: 8, damage: 6, color: '#ff9999', flash: '#ffeaea' }
    };

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function randRange(min, max) {
        return min + Math.random() * (max - min);
    }

    function getCap(key) {
        return isMobile ? PERF[key].mobile : PERF[key].desktop;
    }
    
    // Canvas sizing with devicePixelRatio
    function resizeCanvas() {
        const cssWidth = window.innerWidth;
        const cssHeight = window.innerHeight;
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        updateVignette();
    }
    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
        updateJoystickBaseMetrics();
    });

    function updateVignette() {
        const w = canvas.width / dpr;
        const h = canvas.height / dpr;
        vignetteGradient = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) / 4, w / 2, h / 2, Math.max(w, h) / 1.5);
        vignetteGradient.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGradient.addColorStop(1, 'rgba(0,0,0,0.35)');
    }

    // Game state
    let gameState = 'playing'; // 'playing', 'paused', 'gameOver'
    let paused = false;
    let muted = false;
    let debug = false;
    let score = 0;
    let wave = 1;
    let screenShake = { x: 0, y: 0 };
    let shakeDecay = 0.92;
    let hitstop = 0;
    
    // Combo system
    let combo = 0;
    let comboTimer = 0;
    let comboResetTime = 2;

    // Weapons and buffs
    let currentWeapon = 'pistol';
    let weaponOverride = null;
    let weaponOverrideTimer = 0;
    let weaponCooldown = 0;
    let laserHeat = 0;
    let laserOverheated = false;
    let laserBeam = { active: false, x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0, timer: 0 };
    let lastShotTime = 0;
    const buffs = { rapid: 0, damage: 0 };

    // Pools and entities
    const bulletPool = [];
    const particlePool = [];
    const enemyPool = [];
    const shockwavePool = [];
    const enemyBulletPool = [];
    const pickupPool = [];
    const floaterPool = [];

    let bullets = [];
    let enemies = [];
    let particles = [];
    let shockwaves = [];
    let enemyBullets = [];
    let pickups = [];
    let floaters = [];
    let explosionsThisFrame = 0;
    const MAX_EXPLOSIONS_PER_FRAME = 4;

    // Input state
    const keysDown = {};
    const mouse = { x: 0, y: 0, down: false, worldX: 0, worldY: 0 };
    const inputDebug = {
        keyboard: { x: 0, y: 0 },
        joystick: { x: 0, y: 0 },
        final: { x: 0, y: 0 }
    };
    let lastPointerType = 'unknown';
    
    // Mobile touch controls
    let isMobile = false;
    const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    let touchEnabled = false;
    let touchJoystick = { active: false, centerX: 0, centerY: 0, x: 0, y: 0, radius: 60 };
    let touchAim = { active: false, x: 0, y: 0 };
    let mobileMoveInput = { x: 0, y: 0 };
    let mobileMoveTarget = { x: 0, y: 0 };
    let joystickPointerId = null;
    let aimPointerId = null;
    const joystickDeadzone = 0.15;
    const joystickLerp = 0.2;
    
    // Sound spam limiter
    let soundTimestamps = [];
    const maxSoundsPerSecond = 20;

    const debugMobileZones = false;
    
    function clearInputState() {
        Object.keys(keysDown).forEach((key) => {
            keysDown[key] = false;
        });
        mouse.down = false;
        touchAim.active = false;
        touchJoystick.active = false;
        mobileMoveInput.x = 0;
        mobileMoveInput.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        joystickPointerId = null;
        aimPointerId = null;
    }

    // Input handlers
    window.addEventListener('keydown', (e) => {
        keysDown[e.code] = true;
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
            paused = !paused;
            gameState = paused ? 'paused' : 'playing';
        }
        if (e.key === 'r' || e.key === 'R') {
            restart();
        }
        if (e.key === 'm' || e.key === 'M') {
            muted = !muted;
        }
        if (e.key === '~' || e.key === '`') {
            debug = !debug;
        }
        if (e.key === '1') {
            weaponOverrideTimer = 0;
            setWeapon('pistol');
        }
        if (e.key === '2') {
            weaponOverrideTimer = 0;
            setWeapon('shotgun');
        }
        if (e.key === '3') {
            weaponOverrideTimer = 0;
            setWeapon('laser');
        }
        if (e.key === '4') {
            weaponOverrideTimer = 0;
            setWeapon('rocket');
        }
    });
    
    window.addEventListener('keyup', (e) => {
        keysDown[e.code] = false;
    });

    window.addEventListener('blur', clearInputState);
    
    function updateMousePosition(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = clientX - rect.left;
        mouse.y = clientY - rect.top;
        mouse.worldX = mouse.x;
        mouse.worldY = mouse.y;
    }

    canvas.addEventListener('pointermove', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        lastPointerType = e.pointerType || 'mouse';
        updateMousePosition(e.clientX, e.clientY);
    });
    
    canvas.addEventListener('pointerdown', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        lastPointerType = e.pointerType || 'mouse';
        if (e.button === 0) mouse.down = true;
    });
    
    canvas.addEventListener('pointerup', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        lastPointerType = e.pointerType || 'mouse';
        if (e.button === 0) mouse.down = false;
    });

    canvas.addEventListener('pointerleave', (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        mouse.down = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Mobile touch controls setup
    const joystickBase = document.getElementById('joystickBase');
    const joystickKnob = document.getElementById('joystickKnob');
    const dashButton = document.getElementById('dashButton');
    const pauseButton = document.getElementById('pauseButton');
    const muteButton = document.getElementById('muteButton');
    const mobileControls = document.getElementById('uiOverlay');
    const leftZone = document.getElementById('leftZone');
    const rightZone = document.getElementById('rightZone');
    const audioHint = document.getElementById('audioHint');

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function getFromPool(pool, factory) {
        return pool.length > 0 ? pool.pop() : factory();
    }

    function releaseToPool(pool, obj) {
        pool.push(obj);
    }

    function removeAt(arr, index, pool) {
        const item = arr[index];
        const last = arr.length - 1;
        if (index !== last) arr[index] = arr[last];
        arr.pop();
        if (pool) {
            item.active = false;
            releaseToPool(pool, item);
        }
    }

    function getActiveWeaponId() {
        return weaponOverride && weaponOverrideTimer > 0 ? weaponOverride : currentWeapon;
    }

    function setWeapon(id) {
        if (WEAPONS[id]) {
            currentWeapon = id;
        }
    }

    function updateJoystickBaseMetrics() {
        if (!joystickBase || !joystickKnob) return;
        const baseRect = joystickBase.getBoundingClientRect();
        if (baseRect.width === 0 || baseRect.height === 0) return;
        const canvasRect = canvas.getBoundingClientRect();
        touchJoystick.centerX = baseRect.left - canvasRect.left + baseRect.width / 2;
        touchJoystick.centerY = baseRect.top - canvasRect.top + baseRect.height / 2;
        touchJoystick.radius = baseRect.width / 2;
        resetJoystickKnob();
    }

    function setJoystickKnob(x, y) {
        const canvasHeight = canvas.height / dpr;
        joystickKnob.style.left = `${x}px`;
        joystickKnob.style.bottom = `${canvasHeight - y}px`;
    }

    function resetJoystickKnob() {
        setJoystickKnob(touchJoystick.centerX, touchJoystick.centerY);
    }
    
    // Touch controls gating (desktop vs mobile)
    function enableTouchControls() {
        if (touchEnabled) return;
        touchEnabled = true;
        isMobile = true;
        document.body.classList.add('mobile-input');
        if (debugMobileZones) {
            document.body.classList.add('debug-mobile-zones');
        }
        if (mobileControls) mobileControls.classList.add('active');
        if (audioHint) audioHint.classList.add('show');
        if (leftZone) {
            leftZone.style.display = 'block';
            leftZone.style.pointerEvents = 'auto';
        }
        if (rightZone) {
            rightZone.style.display = 'block';
            rightZone.style.pointerEvents = 'auto';
        }
        updateJoystickBaseMetrics();
    }

    function disableTouchControls() {
        touchEnabled = false;
        isMobile = false;
        document.body.classList.remove('mobile-input');
        document.body.classList.remove('debug-mobile-zones');
        if (mobileControls) mobileControls.classList.remove('active');
        if (audioHint) audioHint.classList.remove('show');
        if (leftZone) {
            leftZone.style.display = 'none';
            leftZone.style.pointerEvents = 'none';
        }
        if (rightZone) {
            rightZone.style.display = 'none';
            rightZone.style.pointerEvents = 'none';
        }
        mobileMoveInput.x = 0;
        mobileMoveInput.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        touchJoystick.active = false;
        touchAim.active = false;
    }

    if (hasTouch) {
        enableTouchControls();
    } else {
        disableTouchControls();
    }

    document.addEventListener('pointerdown', (e) => {
        lastPointerType = e.pointerType || 'unknown';
        if (e.pointerType === 'touch') {
            enableTouchControls();
        }
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
        if (e.pointerType) {
            lastPointerType = e.pointerType;
        }
    }, { passive: true });
    
    function getCanvasCoords(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    function updateJoystickFromPoint(x, y) {
        const dx = x - touchJoystick.centerX;
        const dy = y - touchJoystick.centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxDist = touchJoystick.radius;

        if (dist > 0) {
            const clampedDist = Math.min(dist, maxDist);
            const clampedX = (dx / dist) * clampedDist;
            const clampedY = (dy / dist) * clampedDist;
            setJoystickKnob(touchJoystick.centerX + clampedX, touchJoystick.centerY + clampedY);

            const normalized = clampedDist / maxDist;
            const strength = normalized <= joystickDeadzone
                ? 0
                : (normalized - joystickDeadzone) / (1 - joystickDeadzone);
            touchJoystick.x = (dx / dist) * strength;
            touchJoystick.y = (dy / dist) * strength;
        } else {
            touchJoystick.x = 0;
            touchJoystick.y = 0;
            resetJoystickKnob();
        }

        mobileMoveTarget.x = touchJoystick.x;
        mobileMoveTarget.y = touchJoystick.y;
    }

    function handleLeftPointerDown(e) {
        if (!isMobile || joystickPointerId !== null) return;
        e.preventDefault();
        if (debugMobileZones) {
            console.log('[mobile] leftZone pointerdown', e.pointerId);
        }
        initAudio();
        resumeAudio();
        joystickPointerId = e.pointerId;
        leftZone.setPointerCapture(joystickPointerId);
        touchJoystick.active = true;
        touchJoystick.x = 0;
        touchJoystick.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        if (touchJoystick.centerX === 0 && touchJoystick.centerY === 0) {
            updateJoystickBaseMetrics();
        }
        resetJoystickKnob();
        const pos = getCanvasCoords(e.clientX, e.clientY);
        updateJoystickFromPoint(pos.x, pos.y);
    }

    function handleLeftPointerMove(e) {
        if (!isMobile || e.pointerId !== joystickPointerId || !touchJoystick.active) return;
        e.preventDefault();
        const pos = getCanvasCoords(e.clientX, e.clientY);
        updateJoystickFromPoint(pos.x, pos.y);
    }

    function handleLeftPointerUp(e) {
        if (e.pointerId !== joystickPointerId) return;
        e.preventDefault();
        leftZone.releasePointerCapture(joystickPointerId);
        joystickPointerId = null;
        touchJoystick.active = false;
        touchJoystick.x = 0;
        touchJoystick.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        resetJoystickKnob();
    }

    function handleRightPointerDown(e) {
        if (!isMobile || aimPointerId !== null) return;
        e.preventDefault();
        if (debugMobileZones) {
            console.log('[mobile] rightZone pointerdown', e.pointerId);
        }
        initAudio();
        resumeAudio();
        aimPointerId = e.pointerId;
        rightZone.setPointerCapture(aimPointerId);
        const pos = getCanvasCoords(e.clientX, e.clientY);
        touchAim.active = true;
        touchAim.x = pos.x;
        touchAim.y = pos.y;
        mouse.worldX = pos.x;
        mouse.worldY = pos.y;
        mouse.down = true;
    }

    function handleRightPointerMove(e) {
        if (!isMobile || e.pointerId !== aimPointerId || !touchAim.active) return;
        e.preventDefault();
        const pos = getCanvasCoords(e.clientX, e.clientY);
        touchAim.x = pos.x;
        touchAim.y = pos.y;
        mouse.worldX = pos.x;
        mouse.worldY = pos.y;
    }

    function handleRightPointerUp(e) {
        if (e.pointerId !== aimPointerId) return;
        e.preventDefault();
        rightZone.releasePointerCapture(aimPointerId);
        aimPointerId = null;
        touchAim.active = false;
        mouse.down = false;
    }

    if (leftZone && rightZone) {
        leftZone.addEventListener('pointerdown', handleLeftPointerDown, { passive: false });
        leftZone.addEventListener('pointermove', handleLeftPointerMove, { passive: false });
        leftZone.addEventListener('pointerup', handleLeftPointerUp, { passive: false });
        leftZone.addEventListener('pointercancel', handleLeftPointerUp, { passive: false });

        rightZone.addEventListener('pointerdown', handleRightPointerDown, { passive: false });
        rightZone.addEventListener('pointermove', handleRightPointerMove, { passive: false });
        rightZone.addEventListener('pointerup', handleRightPointerUp, { passive: false });
        rightZone.addEventListener('pointercancel', handleRightPointerUp, { passive: false });
    }
    
    // Button handlers
    dashButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        initAudio();
        resumeAudio();
        keysDown['ShiftLeft'] = true;
    });
    dashButton.addEventListener('pointerup', (e) => {
        e.preventDefault();
        keysDown['ShiftLeft'] = false;
    });
    dashButton.addEventListener('pointercancel', (e) => {
        e.preventDefault();
        keysDown['ShiftLeft'] = false;
    });
    
    pauseButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        paused = !paused;
        gameState = paused ? 'paused' : 'playing';
    });
    
    muteButton.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        muted = !muted;
        muteButton.textContent = muted ? '🔇' : '🔊';
    });
    
    // Click handlers for desktop compatibility
    dashButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        keysDown['ShiftLeft'] = true;
        setTimeout(() => { keysDown['ShiftLeft'] = false; }, 100);
    });
    
    pauseButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        paused = !paused;
        gameState = paused ? 'paused' : 'playing';
    });
    
    muteButton.addEventListener('click', (e) => {
        e.preventDefault();
        initAudio();
        resumeAudio();
        muted = !muted;
        muteButton.textContent = muted ? '🔇' : '🔊';
    });
    
    // Prevent default touch behaviors
    document.addEventListener('touchstart', (e) => {
        if (e.target === canvas || e.target.closest('.mobile-controls') || e.target === leftZone || e.target === rightZone) {
            e.preventDefault();
        }
    }, { passive: false });
    
    document.addEventListener('touchmove', (e) => {
        if (e.target === canvas || e.target.closest('.mobile-controls') || e.target === leftZone || e.target === rightZone) {
            e.preventDefault();
        }
    }, { passive: false });
    
    // Initialize audio on first user interaction
    document.addEventListener('pointerdown', initAudio, { once: true });
    document.addEventListener('touchstart', initAudio, { once: true });
    document.addEventListener('click', initAudio, { once: true });

    // Audio context and sounds (mobile-friendly lazy init)
    let audioContext = null;
    let audioInitialized = false;
    
    function initAudio() {
        if (audioInitialized || muted) return;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioInitialized = true;
            const hint = document.getElementById('audioHint');
            if (hint) hint.classList.remove('show');
        } catch (e) {
            console.warn('WebAudio not supported');
        }
    }
    
    function resumeAudio() {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }
    
    function playSound(frequency, duration, type = 'sine', volume = 0.3, pitchVariation = 0) {
        if (muted || !audioContext) return;
        
        // Sound spam limiter
        const now = Date.now();
        soundTimestamps = soundTimestamps.filter(t => now - t < 1000);
        if (soundTimestamps.length >= maxSoundsPerSecond) return;
        soundTimestamps.push(now);
        
        try {
            resumeAudio();
            
            // Improved sound design
            if (type === 'shoot') {
                // Shoot: square + noise click
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                
                osc1.type = 'square';
                osc1.frequency.value = frequency + (Math.random() - 0.5) * pitchVariation;
                gain1.gain.setValueAtTime(volume * 0.7, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                
                osc2.type = 'square';
                osc2.frequency.value = frequency * 2 + (Math.random() - 0.5) * pitchVariation;
                gain2.gain.setValueAtTime(volume * 0.3, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration * 0.5);
                
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration * 0.5);
            } else if (type === 'shotgun') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 0.6, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume * 0.8, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'laser') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
                gain.gain.setValueAtTime(volume * 0.25, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'rocket') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(frequency * 0.6, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 1.1, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume * 0.5, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'kill') {
                // Kill: low pop + pitch drop
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                
                osc1.type = 'sawtooth';
                osc1.frequency.setValueAtTime(frequency, audioContext.currentTime);
                osc1.frequency.exponentialRampToValueAtTime(frequency * 0.5, audioContext.currentTime + duration);
                gain1.gain.setValueAtTime(volume, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                
                osc2.type = 'sawtooth';
                osc2.frequency.value = frequency * 0.7;
                gain2.gain.setValueAtTime(volume * 0.5, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration * 0.6);
                
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration * 0.6);
            } else if (type === 'pickup') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 1.6, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'shield') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 0.7, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'enemyShoot') {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
                gain.gain.setValueAtTime(volume * 0.5, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'dash') {
                // Dash: whoosh (sawtooth ramp)
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(frequency * 0.5, audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(frequency * 1.5, audioContext.currentTime + duration);
                gain.gain.setValueAtTime(volume, audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.start();
                osc.stop(audioContext.currentTime + duration);
            } else if (type === 'wave') {
                // Wave: chord (two sines)
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain1 = audioContext.createGain();
                const gain2 = audioContext.createGain();
                osc1.type = 'sine';
                osc1.frequency.value = frequency;
                osc2.type = 'sine';
                osc2.frequency.value = frequency * 1.5;
                gain1.gain.setValueAtTime(volume, audioContext.currentTime);
                gain1.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                gain2.gain.setValueAtTime(volume * 0.7, audioContext.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                osc1.connect(gain1);
                osc2.connect(gain2);
                gain1.connect(audioContext.destination);
                gain2.connect(audioContext.destination);
                osc1.start();
                osc2.start();
                osc1.stop(audioContext.currentTime + duration);
                osc2.stop(audioContext.currentTime + duration);
            } else {
                // Default sound
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                const pitch = pitchVariation > 0 ? frequency + (Math.random() - 0.5) * pitchVariation : frequency;
                oscillator.frequency.value = pitch;
                oscillator.type = type;
                gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + duration);
            }
        } catch (e) {
            // Ignore audio errors
        }
    }

    // Game objects
    class Player {
        constructor() {
            this.x = canvas.width / (2 * dpr);
            this.y = canvas.height / (2 * dpr);
            this.radius = 15;
            this.speed = 300;
            this.angle = 0;
            this.hp = 100;
            this.maxHp = 100;
            this.invulnerable = 0;
            this.invulnerableTime = 0.7;
            // Dash system
            this.dashActive = false;
            this.dashTimer = 0;
            this.dashDuration = 0.2;
            this.dashCooldown = 0;
            this.dashCooldownTime = 2;
            this.dashSpeed = 3;
            this.dashDirection = { x: 0, y: 0 };
            this.ghostAfterimages = [];
            this.recoilOffset = 0;
            this.shieldCharges = 0;
            this.shieldTimer = 0;
        }

        update(dt) {
            // Update dash cooldown
            if (this.dashCooldown > 0) {
                this.dashCooldown -= dt;
            }
            
            // Dash activation
            if ((keysDown['ShiftLeft'] || keysDown['ShiftRight']) && !this.dashActive && this.dashCooldown <= 0) {
                let dx = 0, dy = 0;
                if (keysDown['KeyW'] || keysDown['ArrowUp']) dy -= 1;
                if (keysDown['KeyS'] || keysDown['ArrowDown']) dy += 1;
                if (keysDown['KeyA'] || keysDown['ArrowLeft']) dx -= 1;
                if (keysDown['KeyD'] || keysDown['ArrowRight']) dx += 1;
                
                if (dx !== 0 || dy !== 0) {
                    const len = Math.sqrt(dx * dx + dy * dy);
                    this.dashDirection.x = dx / len;
                    this.dashDirection.y = dy / len;
                } else {
                    this.dashDirection.x = Math.cos(this.angle);
                    this.dashDirection.y = Math.sin(this.angle);
                }
                
                this.dashActive = true;
                this.dashTimer = this.dashDuration;
                this.dashCooldown = this.dashCooldownTime;
                this.invulnerable = this.dashDuration;
                const particleCount = isMobile ? 8 : 12;
                spawnParticles(this.x, this.y, particleCount);
                addShake(3);
                playSound(400, 0.2, 'dash', 0.25);
            }
            
            // Dash movement
            if (this.dashActive) {
                this.dashTimer -= dt;
                
                this.ghostAfterimages.push({
                    x: this.x,
                    y: this.y,
                    angle: this.angle,
                    alpha: 0.6,
                    age: 0
                });
                if (this.ghostAfterimages.length > 5) {
                    this.ghostAfterimages.shift();
                }
                
                if (this.dashTimer <= 0) {
                    this.dashActive = false;
                } else {
                    this.x += this.dashDirection.x * this.speed * this.dashSpeed * dt;
                    this.y += this.dashDirection.y * this.speed * this.dashSpeed * dt;
                }
            } else {
                this.ghostAfterimages = this.ghostAfterimages.filter(ghost => {
                    ghost.age += dt;
                    ghost.alpha -= dt * 2;
                    return ghost.alpha > 0;
                });
            }
            
            // Update recoil
            if (this.recoilOffset > 0) {
                this.recoilOffset -= dt * 20;
                if (this.recoilOffset < 0) this.recoilOffset = 0;
            }
            
            if (!this.dashActive) {
                // Normal movement - mobile joystick or keyboard
                let dx = 0, dy = 0;
                let keyDx = 0, keyDy = 0;

                if (isMobile) {
                    mobileMoveInput.x = lerp(mobileMoveInput.x, mobileMoveTarget.x, joystickLerp);
                    mobileMoveInput.y = lerp(mobileMoveInput.y, mobileMoveTarget.y, joystickLerp);
                    if (Math.abs(mobileMoveInput.x) < 0.001) mobileMoveInput.x = 0;
                    if (Math.abs(mobileMoveInput.y) < 0.001) mobileMoveInput.y = 0;
                }

                if (keysDown['KeyW'] || keysDown['ArrowUp']) keyDy -= 1;
                if (keysDown['KeyS'] || keysDown['ArrowDown']) keyDy += 1;
                if (keysDown['KeyA'] || keysDown['ArrowLeft']) keyDx -= 1;
                if (keysDown['KeyD'] || keysDown['ArrowRight']) keyDx += 1;

                if (keyDx !== 0 || keyDy !== 0) {
                    const len = Math.sqrt(keyDx * keyDx + keyDy * keyDy);
                    inputDebug.keyboard.x = keyDx / len;
                    inputDebug.keyboard.y = keyDy / len;
                } else {
                    inputDebug.keyboard.x = 0;
                    inputDebug.keyboard.y = 0;
                }

                if (isMobile) {
                    inputDebug.joystick.x = mobileMoveInput.x;
                    inputDebug.joystick.y = mobileMoveInput.y;
                } else {
                    inputDebug.joystick.x = 0;
                    inputDebug.joystick.y = 0;
                }

                dx = inputDebug.keyboard.x + inputDebug.joystick.x;
                dy = inputDebug.keyboard.y + inputDebug.joystick.y;
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 1) {
                    dx /= len;
                    dy /= len;
                }

                inputDebug.final.x = dx;
                inputDebug.final.y = dy;
                
                if (dx !== 0 || dy !== 0) {
                    this.x += dx * this.speed * dt;
                    this.y += dy * this.speed * dt;
                }
            }
            
            // Keep in bounds
            const margin = this.radius;
            this.x = Math.max(margin, Math.min(canvas.width / dpr - margin, this.x));
            this.y = Math.max(margin, Math.min(canvas.height / dpr - margin, this.y));
            
            // Aim at mouse or touch
            let aimX = mouse.worldX;
            let aimY = mouse.worldY;
            if (isMobile && touchAim.active) {
                aimX = touchAim.x;
                aimY = touchAim.y;
            }
            const dx2 = aimX - this.x;
            const dy2 = aimY - this.y;
            this.angle = Math.atan2(dy2, dx2);
            
            // Update invulnerability
            if (this.invulnerable > 0 && !this.dashActive) {
                this.invulnerable -= dt;
            }

            if (this.shieldTimer > 0) {
                this.shieldTimer -= dt;
                if (this.shieldTimer <= 0) {
                    this.shieldCharges = 0;
                }
            }
        }

        takeDamage(amount) {
            if (this.invulnerable > 0 || this.dashActive) return false;
            if (this.shieldCharges > 0) {
                this.shieldCharges -= 1;
                this.invulnerable = this.invulnerableTime * 0.5;
                addShake(4);
                playSound(420, 0.06, 'shield', 0.3, 40);
                return false;
            }
            this.hp -= amount;
            this.invulnerable = this.invulnerableTime;
            addShake(6);
            hitstop = 0.03;
            playSound(150, 0.08, 'square', 0.4);
            if (this.hp <= 0) {
                this.hp = 0;
                playSound(80, 0.4, 'sawtooth', 0.5);
                return true;
            }
            return false;
        }

        render(ctx) {
            // Render ghost afterimages
            this.ghostAfterimages.forEach(ghost => {
                ctx.save();
                ctx.globalAlpha = ghost.alpha;
                ctx.translate(ghost.x, ghost.y);
                ctx.rotate(ghost.angle);
                ctx.fillStyle = '#4a9eff';
                ctx.beginPath();
                ctx.arc(0, 0, this.radius * 0.8, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });
            
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            
            if (this.dashActive) {
                ctx.shadowBlur = 20;
                ctx.shadowColor = '#4a9eff';
                // Dash invulnerability outline
                ctx.strokeStyle = '#0ff';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.arc(0, 0, this.radius + 2, 0, Math.PI * 2);
                ctx.stroke();
            }

            if (this.shieldCharges > 0) {
                ctx.strokeStyle = '#66ccff';
                ctx.lineWidth = 2;
                ctx.globalAlpha = 0.6;
                ctx.beginPath();
                ctx.arc(0, 0, this.radius + 5, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
            
            if (this.invulnerable > 0 && !this.dashActive) {
                ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.invulnerable * 20);
            }
            
            ctx.fillStyle = '#4a9eff';
            ctx.beginPath();
            ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#2a6fbf';
            ctx.fillRect(this.radius - 2 - this.recoilOffset, -3, 12, 6);
            
            ctx.restore();
            
            // HP bar
            const barWidth = 60;
            const barHeight = 6;
            const barX = this.x - barWidth / 2;
            const barY = this.y - this.radius - 15;
            ctx.fillStyle = '#333';
            ctx.fillRect(barX, barY, barWidth, barHeight);
            ctx.fillStyle = this.hp > 30 ? '#0f0' : '#f00';
            ctx.fillRect(barX, barY, barWidth * (this.hp / this.maxHp), barHeight);
            
            // Dash cooldown indicator
            if (this.dashCooldown > 0) {
                const dashBarWidth = 40;
                const dashBarHeight = 4;
                const dashBarX = this.x - dashBarWidth / 2;
                const dashBarY = this.y + this.radius + 8;
                ctx.fillStyle = '#333';
                ctx.fillRect(dashBarX, dashBarY, dashBarWidth, dashBarHeight);
                ctx.fillStyle = '#0ff';
                ctx.fillRect(dashBarX, dashBarY, dashBarWidth * (1 - this.dashCooldown / this.dashCooldownTime), dashBarHeight);
            }
        }
    }

    class Bullet {
        constructor() {
            this.active = false;
        }

        reset(x, y, angle, speed, damage, radius, lifetime, color, pierce = 0, splash = 0, isEnemy = false) {
            this.x = x;
            this.y = y;
            this.prevX = x;
            this.prevY = y;
            this.angle = angle;
            this.speed = speed;
            this.radius = radius;
            this.lifetime = lifetime;
            this.age = 0;
            this.damage = damage;
            this.color = color;
            this.pierce = pierce;
            this.splash = splash;
            this.isEnemy = isEnemy;
            this.exploded = false;
            this.active = true;
        }

        update(dt) {
            this.prevX = this.x;
            this.prevY = this.y;
            this.x += Math.cos(this.angle) * this.speed * dt;
            this.y += Math.sin(this.angle) * this.speed * dt;
            this.age += dt;
        }

        isOffscreen() {
            const margin = 50;
            return this.x < -margin || this.x > canvas.width / dpr + margin ||
                   this.y < -margin || this.y > canvas.height / dpr + margin ||
                   this.age >= this.lifetime;
        }

        render(ctx) {
            const dist = Math.sqrt((this.x - this.prevX) ** 2 + (this.y - this.prevY) ** 2);
            if (dist > 0) {
                ctx.strokeStyle = this.color;
                ctx.lineWidth = this.isEnemy ? 1.5 : 2;
                ctx.globalAlpha = 0.7;
                ctx.shadowBlur = 6;
                ctx.shadowColor = this.color;
                ctx.beginPath();
                ctx.moveTo(this.prevX, this.prevY);
                ctx.lineTo(this.x, this.y);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1;
            }
            
            ctx.shadowBlur = 6;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    class Enemy {
        constructor() {
            this.active = false;
        }

        reset(type, x, y) {
            const stats = ENEMY_TYPES[type];
            this.type = type;
            this.x = x;
            this.y = y;
            this.radius = stats.radius;
            this.speed = stats.speed;
            this.hp = stats.hp;
            this.maxHp = stats.hp;
            this.damage = stats.damage;
            this.color = stats.color;
            this.flashColor = stats.flash;
            this.hitFlash = 0;
            this.shootCooldown = randRange(0.8, 1.6);
            this.active = true;
        }

        update(dt) {
            if (this.hitFlash > 0) {
                this.hitFlash -= dt;
            }
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            if (this.type === 'runner') {
                const strafe = dist < 180 ? 1 : 0.4;
                const tx = (dx / dist) * (1 - strafe) + (-dy / dist) * strafe;
                const ty = (dy / dist) * (1 - strafe) + (dx / dist) * strafe;
                this.x += tx * this.speed * dt;
                this.y += ty * this.speed * dt;
            } else if (this.type === 'shooter') {
                const desired = 220;
                let vx = dx / dist;
                let vy = dy / dist;
                if (dist < desired * 0.8) {
                    vx = -vx;
                    vy = -vy;
                } else if (dist > desired * 1.2) {
                    // keep moving toward
                } else {
                    const strafeDir = Math.sign(Math.sin((performance.now() / 500) + this.x)) || 1;
                    const sx = -vy * strafeDir;
                    const sy = vx * strafeDir;
                    vx = sx;
                    vy = sy;
                }
                this.x += vx * this.speed * dt;
                this.y += vy * this.speed * dt;

                this.shootCooldown -= dt;
                if (this.shootCooldown <= 0 && dist < 520) {
                    spawnEnemyBullet(this.x, this.y, Math.atan2(dy, dx));
                    this.shootCooldown = randRange(1.1, 1.7);
                }
            } else {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            }
        }

        render(ctx) {
            ctx.fillStyle = this.hitFlash > 0 ? this.flashColor : this.color;
            ctx.shadowBlur = this.type === 'tank' ? 8 : 5;
            ctx.shadowColor = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            
            ctx.strokeStyle = '#aa0000';
            ctx.lineWidth = this.type === 'tank' ? 3 : 2;
            ctx.stroke();
        }
    }

    class Particle {
        constructor() {
            this.active = false;
        }

        reset(x, y, color, size, lifetime) {
            this.x = x;
            this.y = y;
            this.vx = (Math.random() - 0.5) * 200;
            this.vy = (Math.random() - 0.5) * 200;
            this.lifetime = lifetime;
            this.age = 0;
            this.size = size;
            this.color = color;
            this.active = true;
        }

        update(dt) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vx *= 0.95;
            this.vy *= 0.95;
            this.age += dt;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        render(ctx) {
            const alpha = 1 - (this.age / this.lifetime);
            ctx.globalAlpha = alpha;
            ctx.shadowBlur = 4;
            ctx.shadowColor = this.color;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        }
    }

    class Shockwave {
        constructor() {
            this.active = false;
        }

        reset(x, y, maxRadius, lifetime, color) {
            this.x = x;
            this.y = y;
            this.radius = 0;
            this.maxRadius = maxRadius;
            this.lifetime = lifetime;
            this.age = 0;
            this.color = color;
            this.active = true;
        }

        update(dt) {
            this.age += dt;
            this.radius = (this.age / this.lifetime) * this.maxRadius;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        render(ctx) {
            const alpha = 1 - (this.age / this.lifetime);
            ctx.globalAlpha = alpha * 0.6;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    class Pickup {
        constructor() {
            this.active = false;
        }

        reset(type, x, y) {
            this.type = type;
            this.x = x;
            this.y = y;
            this.vx = randRange(-20, 20);
            this.vy = randRange(-20, 20);
            this.radius = 10;
            this.active = true;
        }

        update(dt) {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 140) {
                const pull = (140 - dist) / 140;
                this.vx += (dx / (dist || 1)) * pull * 200 * dt;
                this.vy += (dy / (dist || 1)) * pull * 200 * dt;
            }
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vx *= 0.92;
            this.vy *= 0.92;
            this.x = clamp(this.x, 10, canvas.width / dpr - 10);
            this.y = clamp(this.y, 10, canvas.height / dpr - 10);
        }

        render(ctx) {
            const info = PICKUP_TYPES[this.type];
            ctx.shadowBlur = 6;
            ctx.shadowColor = info.color;
            ctx.fillStyle = info.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius - 3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    class Floater {
        constructor() {
            this.active = false;
        }

        reset(x, y, text, color) {
            this.x = x;
            this.y = y;
            this.text = text;
            this.color = color;
            this.age = 0;
            this.lifetime = 0.8;
            this.active = true;
        }

        update(dt) {
            this.age += dt;
            this.y -= 20 * dt;
        }

        isDead() {
            return this.age >= this.lifetime;
        }

        render(ctx) {
            const alpha = 1 - (this.age / this.lifetime);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.color;
            ctx.font = '14px monospace';
            ctx.fillText(this.text, this.x, this.y);
            ctx.globalAlpha = 1;
        }
    }

    // Game entities
    let player = new Player();
    let enemySpawnTimer = 0;
    let enemySpawnRate = 1.8;
    let enemiesPerWave = 5;
    let waveBannerTime = 0;
    let waveBannerDuration = 2;
    let enemiesSpawnedThisWave = 0;
    
    function getMaxParticles() {
        return getCap('maxParticles');
    }

    function addShake(intensity) {
        screenShake.x += (Math.random() - 0.5) * intensity * 2;
        screenShake.y += (Math.random() - 0.5) * intensity * 2;
    }

    function spawnEnemyAtEdge(type) {
        if (enemies.length >= getCap('maxEnemies')) return false;
        const side = Math.floor(Math.random() * 4);
        const margin = 50;
        let x = 0;
        let y = 0;
        if (side === 0) {
            x = -margin;
            y = Math.random() * canvas.height / dpr;
        } else if (side === 1) {
            x = canvas.width / dpr + margin;
            y = Math.random() * canvas.height / dpr;
        } else if (side === 2) {
            x = Math.random() * canvas.width / dpr;
            y = -margin;
        } else {
            x = Math.random() * canvas.width / dpr;
            y = canvas.height / dpr + margin;
        }
        const enemy = getFromPool(enemyPool, () => new Enemy());
        enemy.reset(type, x, y);
        enemies.push(enemy);
        return true;
    }

    function chooseEnemyType() {
        if (wave < 2) return 'grunt';
        const r = Math.random();
        if (wave < 4) return r < 0.7 ? 'grunt' : 'runner';
        if (wave < 6) return r < 0.6 ? 'grunt' : r < 0.8 ? 'runner' : 'shooter';
        if (wave < 8) return r < 0.45 ? 'grunt' : r < 0.65 ? 'runner' : r < 0.85 ? 'shooter' : 'tank';
        return r < 0.35 ? 'grunt' : r < 0.55 ? 'runner' : r < 0.75 ? 'shooter' : r < 0.9 ? 'tank' : 'swarm';
    }

    function spawnEnemy() {
        if (enemies.length >= getCap('maxEnemies')) return;
        const type = chooseEnemyType();
        if (type === 'swarm') {
            const count = Math.floor(randRange(3, 7));
            let spawned = 0;
            for (let i = 0; i < count; i++) {
                if (spawnEnemyAtEdge('swarm')) spawned++;
            }
            enemiesSpawnedThisWave += spawned;
        } else {
            if (spawnEnemyAtEdge(type)) enemiesSpawnedThisWave += 1;
        }
    }

    function spawnBullet(x, y, angle, weapon) {
        if (bullets.length >= getCap('maxBullets')) return;
        const bullet = getFromPool(bulletPool, () => new Bullet());
        const radius = weapon === WEAPONS.rocket ? 6 : 4;
        const lifetime = weapon === WEAPONS.rocket ? 2.5 : 2;
        const splash = weapon.splash ? weapon.splash : 0;
        bullet.reset(x, y, angle, weapon.speed, weapon.damage, radius, lifetime, weapon.color, 0, splash, false);
        bullets.push(bullet);
    }

    function spawnEnemyBullet(x, y, angle) {
        if (enemyBullets.length >= getCap('maxEnemyBullets')) return;
        const bullet = getFromPool(enemyBulletPool, () => new Bullet());
        bullet.reset(x, y, angle, 260, 8, 3, 3, '#ffdd99', 0, 0, true);
        enemyBullets.push(bullet);
        playSound(260, 0.05, 'enemyShoot', 0.2, 20);
    }

    function spawnParticles(x, y, count) {
        // Limit particle count for performance
        if (particles.length >= getMaxParticles()) return;
        const maxP = getMaxParticles();
        const actualCount = Math.min(count, maxP - particles.length);
        if (actualCount <= 0) return;
        
        for (let i = 0; i < actualCount; i++) {
            const particle = getFromPool(particlePool, () => new Particle());
            const color = `hsl(${randRange(0, 60)}, 100%, ${randRange(50, 80)}%)`;
            particle.reset(x, y, color, randRange(2, 5), randRange(0.4, 0.7));
            particles.push(particle);
        }
    }
    
    function spawnShockwave(x, y, maxRadius = 40, color = '#ffaa00') {
        const shockwave = getFromPool(shockwavePool, () => new Shockwave());
        shockwave.reset(x, y, maxRadius, 0.3, color);
        shockwaves.push(shockwave);
    }

    function spawnPickup(x, y) {
        if (pickups.length >= getCap('maxPickups')) return;
        const chance = Math.random();
        if (chance > 0.22) return;
        const roll = Math.random();
        let type = 'health';
        if (roll < 0.2) type = 'rapid';
        else if (roll < 0.4) type = 'damage';
        else if (roll < 0.6) type = 'shield';
        else if (roll < 0.75) type = 'weapon';
        else type = 'health';

        const px = clamp(x, 20, canvas.width / dpr - 20);
        const py = clamp(y, 20, canvas.height / dpr - 20);
        const pickup = getFromPool(pickupPool, () => new Pickup());
        pickup.reset(type, px, py);
        pickups.push(pickup);
    }

    function spawnFloater(x, y, text, color) {
        if (floaters.length >= getCap('maxFloaters')) return;
        const floater = getFromPool(floaterPool, () => new Floater());
        floater.reset(x, y, text, color);
        floaters.push(floater);
    }

    function applyPickup(type) {
        if (type === 'health') {
            player.hp = clamp(player.hp + 5, 0, player.maxHp);
            spawnFloater(player.x, player.y - 20, '+HP', '#66ff66');
            return;
        }
        if (type === 'rapid') {
            buffs.rapid = PICKUP_TYPES.rapid.duration;
            spawnFloater(player.x, player.y - 20, 'RAPID', PICKUP_TYPES.rapid.color);
            return;
        }
        if (type === 'damage') {
            buffs.damage = PICKUP_TYPES.damage.duration;
            spawnFloater(player.x, player.y - 20, 'DMG+', PICKUP_TYPES.damage.color);
            return;
        }
        if (type === 'shield') {
            player.shieldCharges = clamp(player.shieldCharges + 1, 0, 3);
            player.shieldTimer = PICKUP_TYPES.shield.duration;
            spawnFloater(player.x, player.y - 20, 'SHIELD', PICKUP_TYPES.shield.color);
            return;
        }
        if (type === 'weapon') {
            const options = ['shotgun', 'laser', 'rocket'];
            weaponOverride = options[Math.floor(Math.random() * options.length)];
            weaponOverrideTimer = PICKUP_TYPES.weapon.duration;
            spawnFloater(player.x, player.y - 20, WEAPONS[weaponOverride].name.toUpperCase(), PICKUP_TYPES.weapon.color);
        }
    }

    function getFireRateMultiplier() {
        return buffs.rapid > 0 ? 0.6 : 1;
    }

    function getDamageMultiplier() {
        return buffs.damage > 0 ? 1.3 : 1;
    }

    function pointSegmentDistance(px, py, x1, y1, x2, y2) {
        const vx = x2 - x1;
        const vy = y2 - y1;
        const wx = px - x1;
        const wy = py - y1;
        const c1 = vx * wx + vy * wy;
        if (c1 <= 0) return Math.sqrt(wx * wx + wy * wy);
        const c2 = vx * vx + vy * vy;
        if (c2 <= c1) return Math.sqrt((px - x2) ** 2 + (py - y2) ** 2);
        const b = c1 / c2;
        const bx = x1 + b * vx;
        const by = y1 + b * vy;
        const dx = px - bx;
        const dy = py - by;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function handleShooting(dt, currentTime) {
        const now = currentTime / 1000;
        const isShooting = mouse.down || keysDown['Space'] || (isMobile && touchAim.active);
        const weaponId = getActiveWeaponId();
        const weapon = WEAPONS[weaponId];
        const fireRate = weapon.fireRate * getFireRateMultiplier();
        weaponCooldown = Math.max(0, weaponCooldown - dt);

        if (weaponId === 'laser') {
            if (!isShooting) {
                laserHeat = Math.max(0, laserHeat - weapon.coolRate * dt);
                if (laserOverheated && laserHeat < weapon.resume) laserOverheated = false;
                laserBeam.active = false;
                return;
            }

            if (laserOverheated) {
                laserHeat = Math.max(0, laserHeat - weapon.coolRate * dt);
                if (laserHeat < weapon.resume) laserOverheated = false;
                return;
            }

            if (weaponCooldown <= 0) {
                const range = weapon.range;
                const x1 = player.x;
                const y1 = player.y;
                const x2 = player.x + Math.cos(player.angle) * range;
                const y2 = player.y + Math.sin(player.angle) * range;
                laserBeam.active = true;
                laserBeam.x1 = x1;
                laserBeam.y1 = y1;
                laserBeam.x2 = x2;
                laserBeam.y2 = y2;
                laserBeam.alpha = 0.9;
                laserBeam.timer = 0.04;

                for (let i = enemies.length - 1; i >= 0; i--) {
                    const enemy = enemies[i];
                    const dist = pointSegmentDistance(enemy.x, enemy.y, x1, y1, x2, y2);
                    if (dist < enemy.radius + 6) {
                        enemy.hitFlash = 0.06;
                        enemy.hp -= weapon.damage * getDamageMultiplier();
                        if (enemy.hp <= 0) {
                            applyEnemyDeath(enemy, i);
                        }
                    }
                }

                playSound(520, 0.04, 'laser', 0.2, 60);
                weaponCooldown = fireRate;
                laserHeat += weapon.heatPerShot;
                lastShotTime = now;
                if (laserHeat >= weapon.overheat) {
                    laserOverheated = true;
                }
            }
            return;
        }

        if (!isShooting || weaponCooldown > 0) return;

        const pelletCount = weapon.pellets;
        const spread = weapon.spread;
        for (let i = 0; i < pelletCount; i++) {
            const offset = (i - (pelletCount - 1) / 2) * spread;
            const angle = player.angle + offset + randRange(-spread * 0.2, spread * 0.2);
            const bulletX = player.x + Math.cos(angle) * (player.radius + 6);
            const bulletY = player.y + Math.sin(angle) * (player.radius + 6);
            spawnBullet(bulletX, bulletY, angle, weapon);
        }
        lastShotTime = now;
        weaponCooldown = fireRate;
        player.recoilOffset = weaponId === 'shotgun' ? 5 : 3;
        playSound(weaponId === 'shotgun' ? 420 : 800, weaponId === 'shotgun' ? 0.08 : 0.05, weapon.sfx, 0.25, 80);
    }

    function applyEnemyDeath(enemy, index) {
        const particleCount = enemy.type === 'tank' ? (isMobile ? 20 : 32) : (isMobile ? 12 : 20);
        spawnParticles(enemy.x, enemy.y, particleCount);
        spawnShockwave(enemy.x, enemy.y, enemy.type === 'tank' ? 60 : 40, enemy.type === 'tank' ? '#ff9966' : '#ffaa00');
        spawnPickup(enemy.x, enemy.y);
        combo++;
        comboTimer = comboResetTime;
        const scoreGain = 10 * combo;
        spawnFloater(enemy.x + 6, enemy.y - 6, `+${scoreGain}`, '#ffdd66');
        score += scoreGain;
        hitstop = enemy.type === 'tank' ? 0.06 : 0.04;
        addShake(enemy.type === 'tank' ? 14 : 10);
        playSound(200, 0.15, 'kill', 0.3);
        removeAt(enemies, index, enemyPool);
    }

    function checkCollisions() {
        // Bullets vs Enemies
        for (let i = bullets.length - 1; i >= 0; i--) {
            const bullet = bullets[i];
            let bulletRemoved = false;
            for (let j = enemies.length - 1; j >= 0; j--) {
                const enemy = enemies[j];
                const dx = bullet.x - enemy.x;
                const dy = bullet.y - enemy.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const hitRadius = isMobile ? bullet.radius + enemy.radius + 2 : bullet.radius + enemy.radius;
                if (dist < hitRadius) {
                    enemy.hitFlash = 0.1;
                    enemy.hp -= bullet.damage * (buffs.damage > 0 ? 1.3 : 1);

                    if (bullet.splash > 0 && !bullet.exploded && explosionsThisFrame < MAX_EXPLOSIONS_PER_FRAME) {
                        bullet.exploded = true;
                        explosionsThisFrame++;
                        for (let k = enemies.length - 1; k >= 0; k--) {
                            const other = enemies[k];
                            const sdx = bullet.x - other.x;
                            const sdy = bullet.y - other.y;
                            const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
                            if (sdist < bullet.splash + other.radius) {
                                other.hitFlash = 0.08;
                                other.hp -= bullet.damage * 0.6;
                                if (other.hp <= 0) {
                                    applyEnemyDeath(other, k);
                                }
                            }
                        }
                        spawnShockwave(bullet.x, bullet.y, bullet.splash, '#ffbb66');
                        addShake(6);
                    }

                    if (enemy.hp <= 0) {
                        const enemyIndex = enemies.indexOf(enemy);
                        if (enemyIndex !== -1) {
                            applyEnemyDeath(enemy, enemyIndex);
                        }
                    }

                    removeAt(bullets, i, bulletPool);
                    bulletRemoved = true;
                    break;
                }
            }
            if (bulletRemoved) continue;
        }

        // Enemy bullets vs Player
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const bullet = enemyBullets[i];
            const dx = bullet.x - player.x;
            const dy = bullet.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bullet.radius + player.radius) {
                const died = player.takeDamage(bullet.damage);
                removeAt(enemyBullets, i, enemyBulletPool);
                if (died) {
                    const particleCount = isMobile ? 20 : 30;
                    spawnParticles(player.x, player.y, particleCount);
                    gameState = 'gameOver';
                }
            }
        }

        // Enemies vs Player
        for (let i = enemies.length - 1; i >= 0; i--) {
            const enemy = enemies[i];
            const dx = enemy.x - player.x;
            const dy = enemy.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < enemy.radius + player.radius) {
                const died = player.takeDamage(enemy.damage);
                if (died) {
                    const particleCount = isMobile ? 20 : 30;
                    spawnParticles(player.x, player.y, particleCount);
                    gameState = 'gameOver';
                }
                const particleCount = isMobile ? 12 : 18;
                spawnParticles(enemy.x, enemy.y, particleCount);
                removeAt(enemies, i, enemyPool);
                
                combo = 0;
                comboTimer = 0;
                
                score += 10;
                addShake(8);
                hitstop = 0.03;
                playSound(150, 0.08, 'square', 0.4);
            }
        }

        // Pickups vs Player
        for (let i = pickups.length - 1; i >= 0; i--) {
            const pickup = pickups[i];
            const dx = pickup.x - player.x;
            const dy = pickup.y - player.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < pickup.radius + player.radius) {
                applyPickup(pickup.type);
                spawnParticles(pickup.x, pickup.y, isMobile ? 10 : 16);
                playSound(600, 0.1, 'pickup', 0.3, 60);
                removeAt(pickups, i, pickupPool);
            }
        }
    }

    function restart() {
        player = new Player();
        bullets = [];
        enemies = [];
        particles = [];
        shockwaves = [];
        enemyBullets = [];
        pickups = [];
        floaters = [];
        score = 0;
        wave = 1;
        enemySpawnTimer = 0;
        enemiesPerWave = 6;
        enemySpawnRate = 1.8;
        waveBannerTime = 0;
        enemiesSpawnedThisWave = 0;
        gameState = 'playing';
        paused = false;
        screenShake = { x: 0, y: 0 };
        hitstop = 0;
        combo = 0;
        comboTimer = 0;
        lastShotTime = 0;
        weaponCooldown = 0;
        weaponOverride = null;
        weaponOverrideTimer = 0;
        currentWeapon = 'pistol';
        laserHeat = 0;
        laserOverheated = false;
        buffs.rapid = 0;
        buffs.damage = 0;
        touchJoystick.active = false;
        touchAim.active = false;
        mobileMoveInput.x = 0;
        mobileMoveInput.y = 0;
        mobileMoveTarget.x = 0;
        mobileMoveTarget.y = 0;
        joystickPointerId = null;
        aimPointerId = null;
    }

    // Game loop
    let lastTime = performance.now();
    let fps = 60;
    let fpsTimer = 0;

    function gameLoop(currentTime) {
        const dt = Math.min((currentTime - lastTime) / 1000, 0.033);
        lastTime = currentTime;
        explosionsThisFrame = 0;

        fpsTimer += dt;
        if (fpsTimer >= 0.5) {
            fps = Math.round(1 / dt);
            fpsTimer = 0;
        }

        // Render function
        function render() {
            ctx.save();
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            
            ctx.translate(screenShake.x, screenShake.y);

            // Muzzle flash
            if (gameState === 'playing' && !paused) {
                const now = currentTime / 1000;
                const isShooting = mouse.down || keysDown['Space'] || (isMobile && touchAim.active);
                if (isShooting && now - lastShotTime < 0.05) {
                    const flashX = player.x + Math.cos(player.angle) * (player.radius + 8);
                    const flashY = player.y + Math.sin(player.angle) * (player.radius + 8);
                    ctx.save();
                    ctx.translate(flashX, flashY);
                    ctx.rotate(player.angle);
                    ctx.fillStyle = '#ff8800';
                    ctx.globalAlpha = 0.9;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = '#ff8800';
                    ctx.beginPath();
                    ctx.moveTo(0, -4);
                    ctx.lineTo(10, 0);
                    ctx.lineTo(0, 4);
                    ctx.closePath();
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = 1;
                    ctx.restore();
                }
            }
            
            for (let i = 0; i < pickups.length; i++) pickups[i].render(ctx);
            for (let i = 0; i < bullets.length; i++) bullets[i].render(ctx);
            for (let i = 0; i < enemyBullets.length; i++) enemyBullets[i].render(ctx);
            for (let i = 0; i < enemies.length; i++) enemies[i].render(ctx);
            if (laserBeam.active) {
                ctx.save();
                ctx.globalAlpha = laserBeam.alpha;
                ctx.strokeStyle = '#66ddff';
                ctx.lineWidth = 3;
                ctx.shadowBlur = 8;
                ctx.shadowColor = '#66ddff';
                ctx.beginPath();
                ctx.moveTo(laserBeam.x1, laserBeam.y1);
                ctx.lineTo(laserBeam.x2, laserBeam.y2);
                ctx.stroke();
                ctx.restore();
            }
            for (let i = 0; i < shockwaves.length; i++) shockwaves[i].render(ctx);
            for (let i = 0; i < particles.length; i++) particles[i].render(ctx);
            player.render(ctx);
            for (let i = 0; i < floaters.length; i++) floaters[i].render(ctx);

            ctx.restore();

            if (!isMobile) {
                ctx.strokeStyle = '#88cfff';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.arc(mouse.worldX, mouse.worldY, 6, 0, Math.PI * 2);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(mouse.worldX - 10, mouse.worldY);
                ctx.lineTo(mouse.worldX + 10, mouse.worldY);
                ctx.moveTo(mouse.worldX, mouse.worldY - 10);
                ctx.lineTo(mouse.worldX, mouse.worldY + 10);
                ctx.stroke();
            }

            // Subtle scanlines
            ctx.save();
            ctx.globalAlpha = 0.08;
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            for (let y = 0; y < canvas.height / dpr; y += 6) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width / dpr, y);
                ctx.stroke();
            }
            ctx.restore();

            // Vignette
            if (vignetteGradient) {
                ctx.fillStyle = vignetteGradient;
            } else {
                ctx.fillStyle = 'rgba(0,0,0,0.2)';
            }
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

            // Chromatic shake tint on big shake
            const shakeMag = Math.abs(screenShake.x) + Math.abs(screenShake.y);
            if (shakeMag > 8) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.fillStyle = 'rgba(255,0,0,0.04)';
                ctx.fillRect(2, 0, canvas.width / dpr, canvas.height / dpr);
                ctx.fillStyle = 'rgba(0,100,255,0.04)';
                ctx.fillRect(-2, 0, canvas.width / dpr, canvas.height / dpr);
                ctx.restore();
            }
        }

        if (gameState === 'playing' && !paused) {
            // Hitstop handling
            if (hitstop > 0) {
                hitstop -= dt;
                screenShake.x *= shakeDecay;
                screenShake.y *= shakeDecay;
                
                enemies.forEach(enemy => {
                    if (enemy.hitFlash > 0) {
                        enemy.hitFlash -= dt;
                    }
                });
                
                if (player.recoilOffset > 0) {
                    player.recoilOffset -= dt * 20;
                    if (player.recoilOffset < 0) player.recoilOffset = 0;
                }
                
                for (let i = player.ghostAfterimages.length - 1; i >= 0; i--) {
                    const ghost = player.ghostAfterimages[i];
                    ghost.age += dt;
                    ghost.alpha -= dt * 2;
                    if (ghost.alpha <= 0) {
                        player.ghostAfterimages.splice(i, 1);
                    }
                }
                
                // Update shockwaves during hitstop
                for (let i = shockwaves.length - 1; i >= 0; i--) {
                    const sw = shockwaves[i];
                    sw.update(dt);
                    if (sw.isDead()) {
                        removeAt(shockwaves, i, shockwavePool);
                    }
                }
                
                render();
                requestAnimationFrame(gameLoop);
                return;
            }
            
            // Normal updates
            screenShake.x *= shakeDecay;
            screenShake.y *= shakeDecay;
            
            if (comboTimer > 0) {
                comboTimer -= dt;
                if (comboTimer <= 0) {
                    combo = 0;
                }
            }

            if (weaponOverrideTimer > 0) {
                weaponOverrideTimer -= dt;
                if (weaponOverrideTimer <= 0) {
                    weaponOverride = null;
                }
            }

            if (buffs.rapid > 0) buffs.rapid = Math.max(0, buffs.rapid - dt);
            if (buffs.damage > 0) buffs.damage = Math.max(0, buffs.damage - dt);

            player.update(dt);
            handleShooting(dt, currentTime);
            if (player.recoilOffset > 0) {
                player.recoilOffset -= dt * 20;
                if (player.recoilOffset < 0) player.recoilOffset = 0;
            }
            if (laserBeam.active) {
                laserBeam.timer -= dt;
                laserBeam.alpha = Math.max(0, laserBeam.alpha - dt * 2);
                if (laserBeam.timer <= 0) laserBeam.active = false;
            } else if (laserHeat > 0) {
                laserHeat = Math.max(0, laserHeat - 0.2 * dt);
                if (laserOverheated && laserHeat < WEAPONS.laser.resume) {
                    laserOverheated = false;
                }
            }

            for (let i = bullets.length - 1; i >= 0; i--) {
                const bullet = bullets[i];
                bullet.update(dt);
                if (bullet.isOffscreen()) {
                    removeAt(bullets, i, bulletPool);
                }
            }

            for (let i = enemyBullets.length - 1; i >= 0; i--) {
                const bullet = enemyBullets[i];
                bullet.update(dt);
                if (bullet.isOffscreen()) {
                    removeAt(enemyBullets, i, enemyBulletPool);
                }
            }

            enemySpawnTimer -= dt;
            if (waveBannerTime <= 0 && enemySpawnTimer <= 0 && enemiesSpawnedThisWave < enemiesPerWave) {
                spawnEnemy();
                enemySpawnTimer = enemySpawnRate;
            }

            for (let i = 0; i < enemies.length; i++) {
                enemies[i].update(dt);
            }

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                p.update(dt);
                if (p.isDead()) {
                    removeAt(particles, i, particlePool);
                }
            }
            
            // Update shockwaves
            for (let i = shockwaves.length - 1; i >= 0; i--) {
                const sw = shockwaves[i];
                sw.update(dt);
                if (sw.isDead()) {
                    removeAt(shockwaves, i, shockwavePool);
                }
            }

            for (let i = pickups.length - 1; i >= 0; i--) {
                pickups[i].update(dt);
            }

            for (let i = floaters.length - 1; i >= 0; i--) {
                const floater = floaters[i];
                floater.update(dt);
                if (floater.isDead()) {
                    removeAt(floaters, i, floaterPool);
                }
            }

            if (waveBannerTime > 0) {
                waveBannerTime -= dt;
            } else if (enemies.length === 0 && enemiesSpawnedThisWave >= enemiesPerWave && enemySpawnTimer <= 0) {
                wave++;
                enemiesPerWave = 6 + wave * 2;
                enemiesSpawnedThisWave = 0;
                enemySpawnRate = Math.max(0.45, 1.8 - wave * 0.08);
                enemySpawnTimer = 0;
                waveBannerTime = waveBannerDuration;
                playSound(500, 0.3, 'wave', 0.5);
            }

            checkCollisions();
        }
        
        render();

        // UI
        ctx.fillStyle = '#fff';
        ctx.font = '20px monospace';
        ctx.fillText(`Score: ${score}`, 10, 30);
        ctx.fillText(`Wave: ${wave}`, 10, 60);
        ctx.fillText(`HP: ${Math.max(0, Math.floor(player.hp))}`, 10, 90);

        const weaponId = getActiveWeaponId();
        ctx.fillStyle = '#aaddff';
        ctx.fillText(`Weapon: ${WEAPONS[weaponId].name}`, 10, 120);
        if (weaponId === 'laser') {
            const heatX = 10;
            const heatY = 135;
            const heatW = 120;
            const heatH = 6;
            ctx.fillStyle = '#333';
            ctx.fillRect(heatX, heatY, heatW, heatH);
            ctx.fillStyle = laserOverheated ? '#ff6666' : '#66ddff';
            ctx.fillRect(heatX, heatY, heatW * clamp(laserHeat, 0, 1), heatH);
        }
        if (player.shieldCharges > 0) {
            ctx.fillStyle = '#66ccff';
            ctx.fillText(`Shield: ${player.shieldCharges}`, 10, 155);
        }

        let buffLine = 0;
        if (buffs.rapid > 0) {
            ctx.fillStyle = PICKUP_TYPES.rapid.color;
            ctx.fillText(`Rapid ${buffs.rapid.toFixed(1)}s`, 10, 175 + buffLine * 18);
            buffLine++;
        }
        if (buffs.damage > 0) {
            ctx.fillStyle = PICKUP_TYPES.damage.color;
            ctx.fillText(`Damage ${buffs.damage.toFixed(1)}s`, 10, 175 + buffLine * 18);
            buffLine++;
        }
        if (weaponOverrideTimer > 0 && weaponOverride) {
            ctx.fillStyle = PICKUP_TYPES.weapon.color;
            ctx.fillText(`${WEAPONS[weaponOverride].name} ${weaponOverrideTimer.toFixed(1)}s`, 10, 175 + buffLine * 18);
        }
        
        if (combo > 1) {
            const comboScale = 1 + Math.sin(comboTimer * 5) * 0.15;
            const comboAlpha = Math.min(1, comboTimer / comboResetTime * 2);
            ctx.save();
            ctx.translate(10, 120);
            ctx.scale(comboScale, comboScale);
            ctx.globalAlpha = comboAlpha;
            ctx.fillStyle = '#ffaa00';
            ctx.font = 'bold 24px monospace';
            ctx.shadowBlur = 5;
            ctx.shadowColor = '#ffaa00';
            ctx.fillText(`${combo}x COMBO!`, 0, 0);
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
            ctx.restore();
        }
        
        if (muted) {
            ctx.fillStyle = '#ff0';
            ctx.fillText('MUTED', 10, canvas.height / dpr - 10);
        }

        if (isMobile) {
            const debugY = canvas.height / dpr - 30;
            ctx.fillStyle = '#0ff';
            ctx.font = '14px monospace';
            ctx.fillText(`Joy: ${mobileMoveInput.x.toFixed(2)}, ${mobileMoveInput.y.toFixed(2)}`, 10, debugY);
            ctx.fillText(`Shooting: ${touchAim.active}`, 10, debugY + 18);
        }

        if (waveBannerTime > 0) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 48px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`WAVE ${wave}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.textAlign = 'left';
        }

        if (paused) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 36px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('PAUSED', canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.textAlign = 'left';
        }

        if (gameState === 'gameOver') {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 36px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('GAME OVER', canvas.width / (2 * dpr), canvas.height / (2 * dpr) - 40);
            ctx.font = '24px monospace';
            ctx.fillText(`Final Score: ${score}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr));
            ctx.fillText(`Wave: ${wave}`, canvas.width / (2 * dpr), canvas.height / (2 * dpr) + 40);
            ctx.fillText('Press R to restart', canvas.width / (2 * dpr), canvas.height / (2 * dpr) + 80);
            ctx.textAlign = 'left';
        }

        if (debug) {
            ctx.fillStyle = '#0f0';
            ctx.font = '14px monospace';
            ctx.fillText(`FPS: ${fps}`, canvas.width / dpr - 100, 20);
            ctx.fillText(`Bullets: ${bullets.length}`, canvas.width / dpr - 100, 40);
            ctx.fillText(`Enemies: ${enemies.length}`, canvas.width / dpr - 100, 60);
            ctx.fillText(`Particles: ${particles.length}`, canvas.width / dpr - 100, 80);
            ctx.fillText(`Shockwaves: ${shockwaves.length}`, canvas.width / dpr - 150, 100);
            ctx.fillText(`Expl/frame: ${explosionsThisFrame}`, canvas.width / dpr - 150, 120);

            const inputX = canvas.width / dpr - 240;
            let inputY = 150;
            ctx.fillText(`Kbd: ${inputDebug.keyboard.x.toFixed(2)}, ${inputDebug.keyboard.y.toFixed(2)}`, inputX, inputY);
            inputY += 18;
            ctx.fillText(`Joy: ${inputDebug.joystick.x.toFixed(2)}, ${inputDebug.joystick.y.toFixed(2)}`, inputX, inputY);
            inputY += 18;
            ctx.fillText(`Final: ${inputDebug.final.x.toFixed(2)}, ${inputDebug.final.y.toFixed(2)}`, inputX, inputY);
            inputY += 18;
            ctx.fillText(`Shoot(mouse): ${mouse.down}`, inputX, inputY);
            inputY += 18;
            ctx.fillText(`Shoot(touch): ${touchAim.active}`, inputX, inputY);
            inputY += 18;
            ctx.fillText(`Pointer: ${lastPointerType}`, inputX, inputY);
            
            ctx.strokeStyle = '#0f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
            ctx.stroke();
            enemies.forEach(enemy => {
                ctx.beginPath();
                ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
                ctx.stroke();
            });
        }

        requestAnimationFrame(gameLoop);
    }

    requestAnimationFrame(gameLoop);
})();
