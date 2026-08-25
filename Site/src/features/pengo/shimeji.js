// Self-contained Pengo shimeji widget for the Nyx/game shells.
//
// Wires itself to:
//   #nyx-shimeji-toggle — living-eye toggle above Ko-fi
//   .gp-kofi            — Ko-fi button (treated as a climbable platform)
//
// Toggle state is persisted to localStorage so it carries across pages.
(function () {
  const SHIMEJI_BASE = '/assets/shimeji/img/Shimeji';
  const ENABLED_KEY = 'nyx-shimeji-enabled';

  const sprite = (n) => `${SHIMEJI_BASE}/shime${n}.png`;
  const spriteImages = new Array(46);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const ACTIONS = {
    stand:       { frames: [1], durations: [420] },
    walk:        { frames: [1, 2, 1, 3], durations: [210, 210, 210, 210], dx: [0.9, 0.9, 0.9, 0.9] },
    run:         { frames: [1, 2, 1, 3], durations: [165, 165, 165, 165], dx: [1.3, 1.3, 1.3, 1.3] },
    sit:         { frames: [11], durations: [450] },
    sitLookUp:   { frames: [26], durations: [450] },
    spinHead:    { frames: [26, 15, 27, 16, 28, 17, 29, 11], durations: [180, 180, 180, 180, 180, 180, 180, 220] },
    readBook:    { frames: [30, 31, 32, 33], durations: [900, 1200, 1200, 1200] },
    sprawl:      { frames: [21], durations: [650] },
    creep:       { frames: [20, 20, 21, 21, 20, 21], durations: [420, 160, 180, 160, 380, 180], dx: [0.0, 1.15, 1.15, 0.9, 0.0, 0.9] },
    jumping:     { frames: [22], durations: [2000] },
    teleportOut: { frames: [42, 43, 44, 45, 46], durations: [170, 170, 170, 170, 220] },
    teleportIn:  { frames: [46, 45, 44, 43, 42], durations: [170, 170, 170, 170, 220] },
    grabWall:    { frames: [13], durations: [360] },
    climbWallUp: { frames: [14, 14, 12, 13, 13, 13, 12, 14], durations: [260, 120, 120, 120, 260, 120, 120, 120], dy: [0, -0.85, -0.85, -0.85, 0, -1.25, -1.25, -1.25] },
    climbWallDn: { frames: [14, 14, 12, 13, 13, 13, 12, 14], durations: [260, 120, 120, 120, 260, 120, 120, 120], dy: [0, 0.75, 0.75, 0.75, 0, 1.05, 1.05, 1.05] },
    grabCeil:    { frames: [23], durations: [360] },
    climbCeil:   { frames: [25, 25, 23, 24, 24, 24, 23, 25], durations: [260, 120, 120, 120, 260, 120, 120, 120], dx: [0, 0.7, 0.7, 0.7, 0, 1.1, 1.1, 1.1] },
    falling:     { frames: [4], durations: [260] },
    bounce:      { frames: [18, 19], durations: [130, 130] },
    spawnMorph:  { frames: [46, 45, 44, 43, 42], durations: [180, 180, 180, 180, 240] },
    draggedLeftFar:   { frames: [9], durations: [90] },
    draggedLeft:      { frames: [7], durations: [90] },
    draggedLeftNear:  { frames: [5], durations: [90] },
    draggedCenter:    { frames: [1], durations: [90] },
    draggedRightNear: { frames: [6], durations: [90] },
    draggedRight:     { frames: [8], durations: [90] },
    draggedRightFar:  { frames: [10], durations: [90] },
  };

  // Climbable platforms = the Ko-fi rail button (full climb: top, sides,
  // edges). The shimeji toggle is included too but with climbable:false
  // so mascots can perch and walk along its TOP only — they cannot
  // climb the sides, so the button face stays visually unblocked and
  // the click target is never covered.
  function getPlatforms() {
    const plats = [];
    document.querySelectorAll('.gp-kofi').forEach((el) => {
      const r = el.getBoundingClientRect();
      plats.push({
        el,
        climbable: true,
        left: r.left,
        right: r.right,
        top: r.top + window.scrollY,
        bottom: r.bottom + window.scrollY,
        width: r.width,
        height: r.height,
        topY: r.top + window.scrollY + 2,
        leftX: r.left,
        rightX: r.right,
        perchLeft: r.left + 8,
        perchRight: r.right - 8,
      });
    });
    document.querySelectorAll('.gp-nav-eye').forEach((el) => {
      const r = el.getBoundingClientRect();
      plats.push({
        el,
        climbable: false,
        left: r.left,
        right: r.right,
        top: r.top + window.scrollY,
        bottom: r.bottom + window.scrollY,
        width: r.width,
        height: r.height,
        topY: r.top + window.scrollY + 2,
        leftX: r.left,
        rightX: r.right,
        perchLeft: r.left + 8,
        perchRight: r.right - 8,
      });
    });
    return plats;
  }

  class WebMascot {
    constructor(layer, seed = 0, scale = 0.78) {
      this.layer = layer;
      this.seed = seed;
      this.el = new Image();
      this.el.className = 'mascot';
      this.el.alt = '';
      this.el.setAttribute('aria-hidden', 'true');
      this.el.draggable = false;
      this.el.decoding = 'sync';
      this.layer.appendChild(this.el);

      this.anchorX = 64;
      this.anchorY = 128;
      this.scale = scale;
      this.dead = false;
      this.direction = Math.random() > 0.5 ? 1 : -1;
      this.footX = window.innerWidth * 0.5;
      this.footY = this.floorY();
      this.vx = 0;
      this.vy = 0;
      this.gravity = 0.56;
      this.dragging = false;
      this.dragDX = 0;
      this.dragDY = 0;
      this.cursorX = 0;
      this.cursorY = 0;
      this.pointerHistory = [];
      this.lastT = performance.now();
      this.action = ACTIONS.stand;
      this.actionName = 'stand';
      this.frameIndex = 0;
      this.frameElapsed = 0;
      this.state = 'floorIdle';
      this.busyUntil = this.lastT + 1500;
      this.targetX = this.footX;
      this.currentSurface = { type: 'floor', y: this.floorY(), left: 36, right: window.innerWidth - 36 };
      this.currentWall = null;
      this.goalPlatform = null;
      this.lastMoveAt = this.lastT;
      this.lastFootX = this.footX;
      this.lastFootY = this.footY;
      this.teleporting = false;
      this.setAction('stand');
      this.bind();
      this.render();
    }

    floorY() { return window.innerHeight + 6 + window.scrollY; }
    ceilingY() { return 48 + window.scrollY; }
    leftWallX() { return 12; }
    rightWallX() { return window.innerWidth - 12; }

    setFrame(n) { this.el.src = spriteImages[n - 1]?.src || sprite(n); }

    setAction(name, reset = false) {
      if (this.actionName === name && !reset) return;
      this.actionName = name;
      this.action = ACTIONS[name];
      this.frameIndex = 0;
      this.frameElapsed = 0;
      this.setFrame(this.action.frames[0]);
    }

    advanceAction(dt) {
      this.frameElapsed += dt;
      while (this.frameElapsed >= (this.action.durations[this.frameIndex] ?? 120)) {
        this.frameElapsed -= (this.action.durations[this.frameIndex] ?? 120);
        this.frameIndex = (this.frameIndex + 1) % this.action.frames.length;
        this.setFrame(this.action.frames[this.frameIndex]);
      }
    }

    applyActionMotion(dt) {
      const mult = dt / 16.666;
      const dx = this.action.dx?.[this.frameIndex] ?? 0;
      const dy = this.action.dy?.[this.frameIndex] ?? 0;
      this.footX += dx * this.direction * mult;
      this.footY += dy * mult;
      if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) this.lastMoveAt = performance.now();
    }

    surfaceBounds() {
      if (this.currentSurface?.type === 'platform') {
        return { left: this.currentSurface.left + 24, right: this.currentSurface.right - 24, y: this.currentSurface.y };
      }
      return { left: 48, right: window.innerWidth - 48, y: this.floorY() };
    }

    pickPlatform() {
      const plats = getPlatforms();
      if (!plats.length) return null;
      return plats[Math.floor(Math.random() * plats.length)];
    }

    pickSurfaceTarget() {
      const b = this.surfaceBounds();
      return b.left + Math.random() * Math.max(80, b.right - b.left);
    }

    triggerJump(now, boost = 1) {
      if (this.dragging || this.teleporting) return;
      this.state = 'air';
      this.currentSurface = null;
      this.currentWall = null;
      this.goalPlatform = null;
      this.direction = Math.random() < 0.5 ? -1 : 1;
      this.vx = this.direction * (3.1 + Math.random() * 1.8) * boost;
      this.vy = -(11.8 + Math.random() * 2.8) * boost;
      this.setAction('jumping', true);
      this.busyUntil = now + 2000;
      this.lastMoveAt = now;
    }

    startTeleport(targetX, targetY, applyPosition) {
      if (this.dragging || this.teleporting) return;
      this.teleporting = true;
      this.state = 'effect';
      this.currentSurface = null;
      this.currentWall = null;
      this.goalPlatform = null;
      this.vx = 0;
      this.vy = 0;
      this.setAction('teleportOut', true);
      this.busyUntil = performance.now() + 900;
      setTimeout(() => {
        applyPosition();
        this.footX = targetX;
        this.footY = targetY;
        this.setAction('teleportIn', true);
        this.state = 'effect';
        this.busyUntil = performance.now() + 900;
        setTimeout(() => {
          this.teleporting = false;
          if (this.state === 'effect') {
            this.state = this.currentSurface?.type === 'platform' ? 'platformIdle' : 'floorIdle';
            this.setAction('stand', true);
            this.busyUntil = performance.now() + 1200 + Math.random() * 1200;
          }
        }, 900);
      }, 900);
    }

    bind() {
      window.addEventListener('pointermove', (e) => {
        this.cursorX = e.clientX;
        this.cursorY = e.clientY + window.scrollY;
        if (!this.dragging) return;

        const now = performance.now();
        this.pointerHistory.push({ x: e.clientX, y: e.clientY + window.scrollY, t: now });
        while (this.pointerHistory.length > 12) this.pointerHistory.shift();

        this.footX = e.clientX - this.dragDX;
        this.footY = e.clientY + window.scrollY - this.dragDY;

        const gap = this.footX - this.cursorX;
        if (gap < -52) this.setAction('draggedLeftFar');
        else if (gap < -26) this.setAction('draggedLeft');
        else if (gap < -6) this.setAction('draggedLeftNear');
        else if (gap <= 6) this.setAction('draggedCenter');
        else if (gap < 26) this.setAction('draggedRightNear');
        else if (gap < 52) this.setAction('draggedRight');
        else this.setAction('draggedRightFar');

        this.direction = gap >= 0 ? 1 : -1;
        this.render();
      }, { passive: true });

      this.el.addEventListener('pointerdown', (e) => {
        this.dragging = true;
        this.el.classList.add('dragging');
        this.dragDX = e.clientX - this.footX;
        this.dragDY = e.clientY + window.scrollY - this.footY;
        this.pointerHistory = [{ x: e.clientX, y: e.clientY + window.scrollY, t: performance.now() }];
        this.vx = 0;
        this.vy = 0;
        this.state = 'dragging';
        this.goalPlatform = null;
        e.preventDefault();
      });

      window.addEventListener('pointerup', () => {
        if (!this.dragging) return;
        this.dragging = false;
        this.el.classList.remove('dragging');
        const hist = this.pointerHistory;
        let vx = 0, vy = 0;
        if (hist.length >= 2) {
          const a = hist[Math.max(0, hist.length - 5)];
          const b = hist[hist.length - 1];
          const dt = Math.max(8, b.t - a.t);
          vx = ((b.x - a.x) / dt) * 18.5;
          vy = ((b.y - a.y) / dt) * 18.5;
        }
        this.vx = clamp(vx, -32, 32);
        this.vy = clamp(vy, -32, 32);
        this.state = 'air';
        this.currentSurface = null;
        this.currentWall = null;
        this.goalPlatform = null;
        this.setAction('falling', true);
        this.busyUntil = performance.now() + 220;
      });
    }

    chooseGroundBehavior(now) {
      const r = Math.random();
      const onPlatform = this.currentSurface?.type === 'platform';
      const bounds = this.surfaceBounds();
      if (r < 0.34) {
        this.state = 'walk';
        if (onPlatform && Math.random() < 0.35) {
          this.targetX = Math.random() < 0.5 ? bounds.left - 52 : bounds.right + 52;
        } else {
          this.targetX = this.pickSurfaceTarget();
        }
        this.direction = this.targetX >= this.footX ? 1 : -1;
        this.setAction(Math.random() < 0.32 ? 'run' : 'walk', true);
        this.busyUntil = now + 4600 + Math.random() * 2200;
      } else if (r < 0.56) {
        this.state = 'walk';
        if (onPlatform && Math.random() < 0.35) {
          this.targetX = Math.random() < 0.5 ? bounds.left - 46 : bounds.right + 46;
        } else {
          this.targetX = this.pickSurfaceTarget();
        }
        this.direction = this.targetX >= this.footX ? 1 : -1;
        this.setAction('creep', true);
        this.busyUntil = now + 4600 + Math.random() * 2400;
      } else if (r < 0.78) {
        const platform = this.pickPlatform();
        if (platform && this.currentSurface?.type !== 'platform') {
          this.goalPlatform = platform;
          this.targetX = clamp(platform.left + platform.width * (0.28 + Math.random() * 0.44), platform.perchLeft, platform.perchRight);
          this.direction = this.targetX >= this.footX ? 1 : -1;
          this.state = 'walk';
          this.setAction(Math.random() < 0.3 ? 'run' : 'walk', true);
          this.busyUntil = now + 4800 + Math.random() * 2200;
        } else {
          this.state = this.currentSurface?.type === 'platform' ? 'platformIdle' : 'floorIdle';
          this.busyUntil = now + 1200 + Math.random() * 1400;
        }
      } else if (r < 0.86) {
        this.triggerJump(now, 1);
      } else if (r < 0.92) {
        this.state = 'sit';
        this.setAction('sit', true);
        this.busyUntil = now + 5000 + Math.random() * 5000;
      } else if (r < 0.97) {
        this.state = 'sit';
        this.setAction('readBook', true);
        this.busyUntil = now + 6500 + Math.random() * 7000;
      } else {
        this.state = 'sit';
        this.setAction(Math.random() < 0.5 ? 'spinHead' : 'sprawl', true);
        this.busyUntil = now + 5500 + Math.random() * 6500;
      }
    }

    checkStuckDrop(now) {
      const moved = Math.hypot(this.footX - this.lastFootX, this.footY - this.lastFootY);
      if (moved > 6) this.lastMoveAt = now;
      this.lastFootX = this.footX;
      this.lastFootY = this.footY;
      this.teleporting = false;

      const edgeState = this.state === 'wall' || this.state === 'ceiling';
      if (edgeState && now - this.lastMoveAt > 17000) {
        this.state = 'air';
        this.currentWall = null;
        this.currentSurface = null;
        this.goalPlatform = null;
        this.vx = (Math.random() - 0.5) * 1.6;
        this.vy = 1.2;
        this.setAction('falling', true);
        this.busyUntil = now + 200;
        this.lastMoveAt = now;
      }
    }

    attachToFloor(now) {
      this.lastMoveAt = now;
      this.currentSurface = { type: 'floor', y: this.floorY(), left: 36, right: window.innerWidth - 36 };
      this.currentWall = null;
      this.goalPlatform = null;
      this.footY = this.floorY();
      this.vx = 0;
      this.vy = 0;
      this.state = 'floorIdle';
      this.setAction('stand', true);
      this.busyUntil = now + 1600 + Math.random() * 2000;
    }

    attachToPlatformTop(p, now) {
      this.lastMoveAt = now;
      this.currentSurface = { type: 'platform', y: p.topY, left: p.left, right: p.right, el: p.el };
      this.currentWall = null;
      this.goalPlatform = null;
      this.footY = p.topY;
      this.footX = clamp(this.footX, p.perchLeft ?? (p.left + 28), p.perchRight ?? (p.right - 28));
      this.vx = 0;
      this.vy = 0;
      this.state = 'platformIdle';
      this.setAction('stand', true);
      this.busyUntil = now + 1200 + Math.random() * 1400;
    }

    attachToWall(side, now, rect = null) {
      this.lastMoveAt = now;
      this.state = 'wall';
      this.currentWall = {
        side,
        objectRect: rect,
        x: rect ? (side === 'left' ? rect.leftX - 12 : rect.rightX + 12) : (side === 'left' ? -6 : window.innerWidth + 6),
        top: rect ? rect.topY : this.ceilingY(),
        bottom: rect ? rect.bottom - 4 : this.floorY(),
      };
      this.currentSurface = null;
      this.vx = 0;
      this.vy = 0;
      this.footX = this.currentWall.x;
      this.direction = side === 'left' ? 1 : -1;
      this.setAction('grabWall', true);
      this.busyUntil = now + 1500 + Math.random() * 1800;
    }

    attachToCeiling(now) {
      this.lastMoveAt = now;
      this.state = 'ceiling';
      this.currentWall = null;
      this.currentSurface = null;
      this.vx = 0;
      this.vy = 0;
      this.footY = this.ceilingY();
      this.setAction('grabCeil', true);
      this.busyUntil = now + 2600 + Math.random() * 3200;
    }

    bounceOnFloor(now, strength = 0) {
      this.footY = this.floorY();
      if (strength > 4.8) {
        this.vy = -Math.min(8, strength * 0.30);
        this.vx *= 0.72;
        this.state = 'air';
        this.currentSurface = null;
        this.setAction('bounce', true);
        this.busyUntil = now + 180;
      } else {
        this.attachToFloor(now);
      }
    }

    updateAir(dt, now) {
      const mult = dt / 16.666;
      this.advanceAction(dt);

      const prevX = this.footX;
      const prevY = this.footY;
      this.footX += this.vx * mult;
      this.footY += this.vy * mult;
      this.vy += this.gravity * mult;
      this.vx *= Math.pow(0.997, mult);

      const platforms = getPlatforms();

      if (this.footY <= this.ceilingY() && this.vy < -2.0) {
        this.attachToCeiling(now);
        return;
      }

      for (const p of platforms) {
        const crossedTop = prevY <= p.topY && this.footY >= p.topY && this.vy > 0;
        if (crossedTop && this.footX >= p.left + 20 && this.footX <= p.right - 20) {
          this.attachToPlatformTop(p, now);
          return;
        }
        const withinVertical = this.footY >= p.topY + 8 && this.footY <= p.bottom - 4;
        if (p.climbable && withinVertical) {
          if (prevX > p.leftX && this.footX <= p.leftX && this.vx < -2.0) {
            this.attachToWall('left', now, p);
            return;
          }
          if (prevX < p.rightX && this.footX >= p.rightX && this.vx > 2.0) {
            this.attachToWall('right', now, p);
            return;
          }
        }
      }

      if (this.footX <= this.leftWallX() && this.vx < -2.5) {
        this.attachToWall('left', now);
        return;
      }
      if (this.footX >= this.rightWallX() && this.vx > 2.5) {
        this.attachToWall('right', now);
        return;
      }
      if (this.footY >= this.floorY()) {
        this.bounceOnFloor(now, Math.abs(this.vy));
        return;
      }

      this.direction = this.vx >= 0 ? 1 : -1;
      if (this.actionName === 'jumping' && now >= this.busyUntil) this.setAction('falling', true);
    }

    updateWall(dt, now) {
      this.advanceAction(dt);

      if (now >= this.busyUntil) {
        const r = Math.random();
        if (r < 0.68) {
          this.setAction('climbWallUp', true);
          this.busyUntil = now + 4200 + Math.random() * 4200;
        } else if (r < 0.90) {
          this.setAction('climbWallDn', true);
          this.busyUntil = now + 3200 + Math.random() * 2800;
        } else if (r < 0.98) {
          this.setAction('grabWall', true);
          this.busyUntil = now + 3200 + Math.random() * 3500;
        } else {
          this.state = 'air';
          this.currentWall = null;
          this.setAction('falling', true);
          this.vx = this.direction === -1 ? 1.4 + Math.random() * 1.4 : -(1.4 + Math.random() * 1.4);
          this.vy = -1.2 - Math.random() * 1.8;
          return;
        }
      }

      this.applyActionMotion(dt);
      this.footX = this.currentWall.x;

      if (this.currentWall.objectRect?.climbable && this.footY <= this.currentWall.top + 12) {
        this.attachToPlatformTop(this.currentWall.objectRect, now);
        return;
      }
      if (!this.currentWall.objectRect && this.footY <= this.ceilingY() + 12) {
        this.attachToCeiling(now);
        return;
      }
      if (this.footY >= this.currentWall.bottom) {
        this.attachToFloor(now);
      }
    }

    updateCeiling(dt, now) {
      this.advanceAction(dt);
      if (now >= this.busyUntil) {
        const r = Math.random();
        if (r < 0.86) {
          this.direction = Math.random() < 0.5 ? -1 : 1;
          this.setAction('climbCeil', true);
          this.busyUntil = now + 3800 + Math.random() * 4200;
        } else if (r < 0.98) {
          this.setAction('grabCeil', true);
          this.busyUntil = now + 2800 + Math.random() * 3200;
        } else {
          this.state = 'air';
          this.setAction('falling', true);
          this.vx = (Math.random() - 0.5) * 2.2;
          this.vy = 0.7;
          return;
        }
      }
      this.applyActionMotion(dt);
      this.footY = this.ceilingY();
      if (this.footX <= this.leftWallX() + 4) { this.attachToWall('left', now); return; }
      if (this.footX >= this.rightWallX() - 4) { this.attachToWall('right', now); }
    }

    updateSurface(dt, now) {
      this.advanceAction(dt);
      const bounds = this.surfaceBounds();
      this.footY = bounds.y;

      if ((this.state === 'floorIdle' || this.state === 'platformIdle') && this.actionName === 'stand' && now - this.lastMoveAt >= 4000) {
        this.chooseGroundBehavior(now);
        return;
      }
      if ((this.state === 'floorIdle' || this.state === 'platformIdle') && now >= this.busyUntil) {
        this.chooseGroundBehavior(now);
        return;
      }
      if (this.state === 'effect' && now >= this.busyUntil) {
        this.state = this.currentSurface?.type === 'platform' ? 'platformIdle' : 'floorIdle';
        this.setAction('stand', true);
        this.busyUntil = now + 1600 + Math.random() * 2200;
        return;
      }
      if (this.state === 'walk' || this.state === 'approachPerch') {
        this.applyActionMotion(dt);
        if (this.currentSurface?.type !== 'platform') {
          this.footX = clamp(this.footX, bounds.left, bounds.right);
        } else if (this.footX < bounds.left - 8 || this.footX > bounds.right + 8) {
          this.state = 'air';
          this.goalPlatform = null;
          this.currentSurface = null;
          this.currentWall = null;
          this.vx = this.direction * (1.8 + Math.random() * 1.0);
          this.vy = 0.4;
          this.setAction('falling', true);
          this.busyUntil = now + 200;
          return;
        }
        const reached = Math.abs(this.targetX - this.footX) < 10;
        const passed = (this.direction === 1 && this.footX >= this.targetX) || (this.direction === -1 && this.footX <= this.targetX);
        if (reached || passed || now >= this.busyUntil) {
          if (this.goalPlatform && this.currentSurface?.type !== 'platform') {
            const tx = clamp(this.targetX, this.goalPlatform.perchLeft, this.goalPlatform.perchRight);
            const ty = this.goalPlatform.topY;
            const plat = this.goalPlatform;
            this.startTeleport(tx, ty, () => { this.attachToPlatformTop(plat, performance.now()); });
            return;
          }
          this.state = this.currentSurface?.type === 'platform' ? 'platformIdle' : 'floorIdle';
          this.setAction('stand', true);
          this.busyUntil = now + 1600 + Math.random() * 2200;
        }
        return;
      }
      if (this.state === 'sit' && now >= this.busyUntil) {
        this.state = this.currentSurface?.type === 'platform' ? 'platformIdle' : 'floorIdle';
        this.setAction('stand', true);
        this.busyUntil = now + 1500 + Math.random() * 1800;
      }
    }

    update(now) {
      const dt = Math.min(34, now - this.lastT || 16.666);
      this.lastT = now;

      if (window.shimejisEnabled === false) {
        this.el.style.display = 'none';
        return;
      }
      this.el.style.display = '';

      if (this.dragging) { this.advanceAction(dt); this.render(); return; }
      if (this.teleporting) { this.advanceAction(dt); this.render(); return; }

      if (this.state === 'air') this.updateAir(dt, now);
      else if (this.state === 'wall') this.updateWall(dt, now);
      else if (this.state === 'ceiling') this.updateCeiling(dt, now);
      else this.updateSurface(dt, now);

      this.checkStuckDrop(now);
      if (this.state !== 'wall') this.footX = clamp(this.footX, 18, window.innerWidth - 18);
      this.render();
    }

    render() {
      const sitOnPlatform = this.currentSurface?.type === 'platform' && ['sit', 'sitLookUp', 'spinHead', 'readBook', 'sprawl'].includes(this.actionName);
      const yOffset = sitOnPlatform ? 6 : 0;
      this.el.style.left = `${this.footX - this.anchorX}px`;
      this.el.style.top = `${this.footY - this.anchorY + yOffset}px`;
      this.el.style.transform = `scale(${this.scale}) scaleX(${-this.direction})`;
    }
  }

  const SCALE_KEY = 'nyx-shimeji-scale';
  const COUNT_KEY = 'nyx-shimeji-count';
  const DEFAULT_SCALE = 0.78;
  const MIN_SCALE = 0.25;
  const MAX_SCALE = 20;
  const MAX_MASCOTS = 72;

  function loadEnabled() {
    try {
      const v = localStorage.getItem(ENABLED_KEY);
      return v === null ? true : v === 'true';
    } catch { return true; }
  }
  function saveEnabled(v) {
    try { localStorage.setItem(ENABLED_KEY, String(v)); } catch {}
  }
  function loadScale() {
    try {
      const v = parseFloat(localStorage.getItem(SCALE_KEY) || '');
      return Number.isFinite(v) ? clamp(v, MIN_SCALE, MAX_SCALE) : DEFAULT_SCALE;
    } catch { return DEFAULT_SCALE; }
  }
  function saveScale(v) {
    try { localStorage.setItem(SCALE_KEY, String(v)); } catch {}
  }
  function loadCount() {
    try {
      const v = parseInt(localStorage.getItem(COUNT_KEY) || '', 10);
      return Number.isFinite(v) ? clamp(v, 0, MAX_MASCOTS) : 1;
    } catch { return 1; }
  }
  function saveCount(v) {
    try { localStorage.setItem(COUNT_KEY, String(v)); } catch {}
  }

  function init() {
    if (document.getElementById('nyx-shimeji-layer')) return;
    if (!document.getElementById('nyx-shimeji-toggle')) return;

    const style = document.createElement('style');
    style.textContent = [
      '.mascot-layer{position:fixed;inset:0;pointer-events:none;z-index:1200;overflow:hidden}',
      '.mascot{position:absolute;display:block;width:128px;height:128px;transform-origin:64px 128px;will-change:transform,left,top;pointer-events:auto;cursor:grab;user-select:none;filter:drop-shadow(0 8px 18px rgba(0,0,0,0.35))}',
      '.mascot.dragging{cursor:grabbing;transition:none !important}',
      // Popover panel anchored next to the toggle button. Position is
      // computed at open time so it follows the toggle wherever the
      // rail puts it (left rail = popover to the right). The alchemy
      // circle PNG sits beneath a dark overlay so the text stays
      // readable.
      // background: split into discrete properties because the shorthand
      // doesn't allow a comma-separated rgba() color "layer" — only the
      // final layer can carry a background-color, and only without a
      // comma. Splitting also makes the two image layers easy to tune
      // independently (the gradient overlay keeps text readable on top
      // of the alchemy-circle PNG).
      '.shime-pop{position:fixed;z-index:1500;min-width:280px;padding:14px 14px 12px;border-radius:12px;border:1px solid rgba(255,90,130,0.42);background-color:rgba(46,14,22,0.92);background-image:radial-gradient(ellipse at center,rgba(255,76,118,0.34) 0%,rgba(220,40,90,0.22) 55%,rgba(140,20,55,0.18) 100%),url("/assets/shimeji/alchemy-circle.png");background-position:center,center;background-size:auto,85%;background-repeat:no-repeat,no-repeat;box-shadow:0 18px 48px rgba(120,20,50,0.55),0 4px 14px rgba(0,0,0,0.45),0 0 24px rgba(255,80,130,0.18);color:#ffeef1;font:600 13px/1.3 "Inter Tight","Inter",system-ui,sans-serif;backdrop-filter:blur(8px);user-select:none;display:none}',
      '.shime-pop.is-open{display:block}',
      '.shime-pop h3{margin:0 0 10px;font:800 12px/1 "Manrope","Inter",system-ui,sans-serif;letter-spacing:0.14em;text-transform:uppercase;color:#ff9eb4;text-align:center}',
      // Default row (Power / Size): flex with label on the left, control
      // on the right.
      '.shime-pop__row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}',
      '.shime-pop__row:last-child{margin-bottom:0}',
      // Action rows (Spawn / Sacrifice) use a 3-column grid so the
      // stepper and CTA button line up across both rows regardless of
      // the label width.
      '.shime-pop__row--action{display:grid;grid-template-columns:72px auto 1fr;align-items:center;gap:10px}',
      '.shime-pop__row--action .shime-pop__cta{justify-self:end}',
      '.shime-pop__label{flex:0 0 auto;color:#d9b3bd;font-weight:700}',
      // Controls retuned from purple (rgba(167,139,250,*) / #c4a8ff) to
      // the new red-pink Pengo palette: primary accent rgba(255,90,130,*)
      // with #ff9eb4 highlights. Sacrifice (danger CTA) stays a deeper
      // saturated red so it still reads as "destructive" against the
      // softer pink spawn CTA.
      '.shime-pop__seg{display:inline-flex;border:1px solid rgba(255,90,130,0.36);border-radius:7px;overflow:hidden}',
      '.shime-pop__seg button{appearance:none;border:0;background:transparent;color:#d9b3bd;font:inherit;font-weight:800;letter-spacing:0.06em;padding:4px 10px;cursor:pointer;transition:120ms}',
      '.shime-pop__seg button.is-active{background:rgba(255,90,130,0.34);color:#fff}',
      '.shime-pop__seg button:not(.is-active):hover{background:rgba(255,90,130,0.14);color:#ffeef1}',
      '.shime-pop__slider{flex:1;min-width:90px;-webkit-appearance:none;appearance:none;height:6px;border-radius:3px;background:linear-gradient(90deg,rgba(255,90,130,0.20),rgba(255,90,130,0.50));outline:none;cursor:pointer}',
      '.shime-pop__slider::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#ff9eb4;border:2px solid #4d121f;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.55)}',
      '.shime-pop__slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#ff9eb4;border:2px solid #4d121f;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,0.55)}',
      '.shime-pop__size{display:flex;align-items:center;gap:8px;flex:1}',
      '.shime-pop__size-number{appearance:none;-moz-appearance:textfield;width:54px;height:26px;box-sizing:border-box;border:1px solid rgba(255,90,130,0.36);border-radius:7px;padding:0 4px;background:rgba(46,14,22,0.58);color:#ffeef1;font:800 12px/1 "Inter Tight",system-ui,sans-serif;text-align:center;outline:none}',
      '.shime-pop__size-number::-webkit-outer-spin-button,.shime-pop__size-number::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
      '.shime-pop__stepper{display:inline-flex;align-items:center;gap:0;border:1px solid rgba(255,90,130,0.36);border-radius:7px;overflow:hidden}',
      '.shime-pop__stepper button{appearance:none;border:0;background:transparent;color:#ff9eb4;font:800 14px/1 monospace;padding:0;width:24px;height:24px;cursor:pointer;display:grid;place-items:center;transition:120ms}',
      '.shime-pop__stepper button:hover{background:rgba(255,90,130,0.20);color:#fff}',
      '.shime-pop__stepper button:disabled{opacity:0.35;cursor:not-allowed}',
      '.shime-pop__stepper input{appearance:none;-moz-appearance:textfield;background:transparent;border:0;border-left:1px solid rgba(255,90,130,0.28);border-right:1px solid rgba(255,90,130,0.28);color:#ffeef1;font:800 12px/1 "Inter Tight",system-ui,sans-serif;width:34px;height:24px;text-align:center;outline:none}',
      '.shime-pop__stepper input::-webkit-outer-spin-button,.shime-pop__stepper input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}',
      '.shime-pop__cta{appearance:none;border:1px solid rgba(255,90,130,0.46);background:rgba(255,90,130,0.20);color:#ffeef1;font:inherit;font-weight:800;letter-spacing:0.04em;padding:4px 12px;border-radius:7px;cursor:pointer;transition:120ms;min-width:90px}',
      '.shime-pop__cta:hover{background:rgba(255,90,130,0.34);border-color:rgba(255,150,180,0.78);color:#fff}',
      '.shime-pop__cta--danger{border-color:rgba(220,40,80,0.62);background:rgba(180,30,60,0.36);color:#ffd9d9}',
      '.shime-pop__cta--danger:hover{background:rgba(220,40,80,0.55);border-color:rgba(255,80,120,0.85);color:#fff}',
      '.shime-pop__count{flex:0 0 auto;font:700 11px/1 "Inter Tight",system-ui,sans-serif;color:#b88594}',
      '.shime-pop__reset{width:100%;margin-top:4px;padding:6px 12px}',
      '.shime-pop :is(button,input[type="range"],input[type="number"]):focus-visible{outline:2px solid #fff;outline-offset:2px}',
      '@media(max-width:760px){.mascot-layer,.shime-pop{display:none!important}}',
    ].join('');
    document.head.appendChild(style);

    const layer = document.createElement('div');
    layer.className = 'mascot-layer';
    layer.id = 'nyx-shimeji-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);

    // ── State ─────────────────────────────────────────────────────
    window.shimejisEnabled = loadEnabled();
    let scale = loadScale();
    const mascots = [];

    // ── Mascot lifecycle ──────────────────────────────────────────
    // The first mascot ever spawned this session goes to the toggle
    // button (so the user sees where settings live). Every subsequent
    // spawn — and every teleport — drops at a random screen location.
    let hasSpawnedOnce = false;
    function spawnAt(m, opts) {
      const atToggle = opts && opts.atToggle;
      const toggle = atToggle ? document.getElementById('nyx-shimeji-toggle') : null;
      if (toggle) {
        const rect = toggle.getBoundingClientRect();
        m.footX = rect.left + rect.width / 2;
        m.footY = rect.top + rect.height / 2 + window.scrollY;
      } else {
        // Random screen position. Keep some margin so the spawn isn't
        // half-clipped against the edges or buried under the rail.
        const railWidth = 160;
        const minX = railWidth + 60;
        const maxX = window.innerWidth - 60;
        m.footX = minX + Math.random() * Math.max(20, maxX - minX);
        // Spawn a bit below the top of the viewport so the falling
        // animation has runway.
        m.footY = window.scrollY + 80 + Math.random() * 140;
      }
      m.vx = 0;
      m.vy = 0;
      m.currentSurface = null;
      m.currentWall = null;
      m.goalPlatform = null;
      m.state = 'effect';
      m.teleporting = true;
      m.setAction('spawnMorph', true);
      const morphMs = ACTIONS.spawnMorph.durations.reduce((a, b) => a + b, 0);
      m.busyUntil = performance.now() + morphMs;
      setTimeout(() => {
        if (m.dragging || m.dead) return;
        m.teleporting = false;
        m.state = 'air';
        m.vx = (Math.random() - 0.5) * 2;
        m.vy = 0;
        m.setAction('falling', true);
        m.busyUntil = performance.now() + 220;
      }, morphMs);
    }

    function spawnOne() {
      if (mascots.length >= MAX_MASCOTS) return false;
      const m = new WebMascot(layer, mascots.length, scale);
      mascots.push(m);
      spawnAt(m, { atToggle: !hasSpawnedOnce });
      hasSpawnedOnce = true;
      saveCount(mascots.length);
      return true;
    }

    function sacrificeOne() {
      if (mascots.length === 0) return false;
      const m = mascots.pop();
      // Play teleport-out, then remove the DOM node + skip in the
      // physics tick.
      m.teleporting = true;
      m.state = 'effect';
      m.setAction('teleportOut', true);
      const morphMs = ACTIONS.teleportOut.durations.reduce((a, b) => a + b, 0);
      setTimeout(() => {
        m.dead = true;
        if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      }, morphMs);
      saveCount(mascots.length);
      return true;
    }

    function setScaleAll(s) {
      const next = Number.parseFloat(s);
      scale = clamp(Number.isFinite(next) ? next : scale, MIN_SCALE, MAX_SCALE);
      for (const m of mascots) if (!m.dead) m.scale = scale;
      saveScale(scale);
    }

    function setEnabled(v) {
      window.shimejisEnabled = !!v;
      saveEnabled(window.shimejisEnabled);
      updateToggleVisual();
    }

    function resetAll() {
      // Sacrifice everything (without the teleport animation — instant
      // wipe so "Reset" feels decisive), then respawn one at default
      // scale and re-enable.
      while (mascots.length > 0) {
        const m = mascots.pop();
        m.dead = true;
        if (m.el && m.el.parentNode) m.el.parentNode.removeChild(m.el);
      }
      setScaleAll(DEFAULT_SCALE);
      setEnabled(true);
      spawnOne();
      // Sync popover controls to the new state.
      if (popover) syncPopover();
    }

    // ── Toggle button → popover ───────────────────────────────────
    const toggleBtn = document.getElementById('nyx-shimeji-toggle');
    function updateToggleVisual() {
      if (!toggleBtn) return;
      toggleBtn.classList.toggle('off', !window.shimejisEnabled);
    }
    updateToggleVisual();

    // ── Popover construction ──────────────────────────────────────
    let popover = null;
    let popoverOpen = false;
    let popoverEls = {};

    function buildPopover() {
      const pop = document.createElement('div');
      pop.className = 'shime-pop';
      pop.id = 'nyx-shimeji-menu';
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Magnum Opus Pengonis');
      pop.innerHTML = [
        '<h3>Magnum Opus Pengonis</h3>',
        '<div class="shime-pop__row">',
          '<span class="shime-pop__label">Power</span>',
          '<div class="shime-pop__seg" role="group" aria-label="Enable Pengo">',
            '<button type="button" data-shime-on>On</button>',
            '<button type="button" data-shime-off>Off</button>',
          '</div>',
        '</div>',
        '<div class="shime-pop__row">',
          '<span class="shime-pop__label">Size</span>',
          '<div class="shime-pop__size">',
            '<input type="range" class="shime-pop__slider" data-shime-size min="' + MIN_SCALE + '" max="' + MAX_SCALE + '" step="0.01" aria-label="Pengo size" />',
            '<input type="number" class="shime-pop__size-number" data-shime-size-number min="' + MIN_SCALE + '" max="' + MAX_SCALE + '" step="0.01" aria-label="Pengo size value" />',
          '</div>',
        '</div>',
        '<div class="shime-pop__row shime-pop__row--action">',
          '<span class="shime-pop__label">Spawn</span>',
          '<div class="shime-pop__stepper" aria-label="Spawn quantity">',
            '<button type="button" data-spawn-dec aria-label="Decrease">−</button>',
            '<input type="number" data-spawn-qty min="1" max="' + MAX_MASCOTS + '" value="1" inputmode="numeric" />',
            '<button type="button" data-spawn-inc aria-label="Increase">+</button>',
          '</div>',
          '<button type="button" class="shime-pop__cta" data-spawn-go>Spawn</button>',
        '</div>',
        '<div class="shime-pop__row shime-pop__row--action">',
          '<span class="shime-pop__label">Sacrifice</span>',
          '<div class="shime-pop__stepper" aria-label="Sacrifice quantity">',
            '<button type="button" data-kill-dec aria-label="Decrease">−</button>',
            '<input type="number" data-kill-qty min="1" max="' + MAX_MASCOTS + '" value="1" inputmode="numeric" />',
            '<button type="button" data-kill-inc aria-label="Increase">+</button>',
          '</div>',
          '<button type="button" class="shime-pop__cta shime-pop__cta--danger" data-kill-go>Sacrifice</button>',
        '</div>',
        '<div class="shime-pop__row">',
          '<span class="shime-pop__count" data-shime-count>0 active</span>',
          '<button type="button" class="shime-pop__cta shime-pop__reset" data-shime-reset>Reset</button>',
        '</div>',
      ].join('');
      document.body.appendChild(pop);

      popoverEls = {
        on:      pop.querySelector('[data-shime-on]'),
        off:     pop.querySelector('[data-shime-off]'),
        size:    pop.querySelector('[data-shime-size]'),
        sizeNumber:pop.querySelector('[data-shime-size-number]'),
        spawnQty:pop.querySelector('[data-spawn-qty]'),
        spawnInc:pop.querySelector('[data-spawn-inc]'),
        spawnDec:pop.querySelector('[data-spawn-dec]'),
        spawnGo: pop.querySelector('[data-spawn-go]'),
        killQty: pop.querySelector('[data-kill-qty]'),
        killInc: pop.querySelector('[data-kill-inc]'),
        killDec: pop.querySelector('[data-kill-dec]'),
        killGo:  pop.querySelector('[data-kill-go]'),
        count:   pop.querySelector('[data-shime-count]'),
        reset:   pop.querySelector('[data-shime-reset]'),
      };

      // Power toggle.
      popoverEls.on.addEventListener('click', () => { setEnabled(true); syncPopover(); });
      popoverEls.off.addEventListener('click', () => { setEnabled(false); syncPopover(); });

      // The range stays live; numeric typing keeps its in-progress text.
      popoverEls.size.addEventListener('input', () => {
        setScaleAll(popoverEls.size.value);
        syncPopover();
      });
      popoverEls.sizeNumber.addEventListener('input', () => {
        const next = Number.parseFloat(popoverEls.sizeNumber.value);
        if (!Number.isFinite(next)) return;
        setScaleAll(next);
        popoverEls.size.value = String(scale);
      });
      const commitSizeNumber = () => {
        setScaleAll(popoverEls.sizeNumber.value);
        syncPopover();
      };
      popoverEls.sizeNumber.addEventListener('change', commitSizeNumber);
      popoverEls.sizeNumber.addEventListener('blur', commitSizeNumber);

      // Stepper helpers. Clamp value, keep input string in sync.
      const stepper = (input, dec, inc, min, max) => {
        const read = () => clamp(parseInt(input.value, 10) || min, min, max);
        const sync = () => { input.value = String(read()); };
        dec.addEventListener('click', () => { input.value = String(clamp(read() - 1, min, max)); });
        inc.addEventListener('click', () => { input.value = String(clamp(read() + 1, min, max)); });
        input.addEventListener('change', sync);
        input.addEventListener('blur', sync);
        return read;
      };
      const readSpawn = stepper(popoverEls.spawnQty, popoverEls.spawnDec, popoverEls.spawnInc, 1, MAX_MASCOTS);
      const readKill  = stepper(popoverEls.killQty,  popoverEls.killDec,  popoverEls.killInc,  1, MAX_MASCOTS);

      popoverEls.spawnGo.addEventListener('click', () => {
        const n = readSpawn();
        for (let i = 0; i < n; i++) {
          if (!spawnOne()) break;
        }
        syncPopover();
      });
      popoverEls.killGo.addEventListener('click', () => {
        const n = readKill();
        for (let i = 0; i < n; i++) {
          if (!sacrificeOne()) break;
        }
        syncPopover();
      });
      popoverEls.reset.addEventListener('click', () => {
        resetAll();
      });

      // Click outside / Escape closes.
      document.addEventListener('pointerdown', (e) => {
        if (!popoverOpen) return;
        const target = e.target;
        if (pop.contains(target) || (toggleBtn && toggleBtn.contains(target))) return;
        closePopover();
      });
      document.addEventListener('keydown', (e) => {
        if (popoverOpen && e.key === 'Escape') closePopover(true);
      });
      // Reposition on resize / scroll while open.
      window.addEventListener('resize', () => {
        if (!toggleBtn.getClientRects().length) {
          if (popoverOpen) closePopover();
          return;
        }
        if (popoverOpen) positionPopover();
      });
      window.addEventListener('scroll', () => { if (popoverOpen) positionPopover(); }, { passive: true });

      return pop;
    }

    function syncPopover() {
      if (!popover) return;
      popoverEls.on.classList.toggle('is-active', !!window.shimejisEnabled);
      popoverEls.off.classList.toggle('is-active', !window.shimejisEnabled);
      popoverEls.on.setAttribute('aria-pressed', String(!!window.shimejisEnabled));
      popoverEls.off.setAttribute('aria-pressed', String(!window.shimejisEnabled));
      popoverEls.size.value = String(scale);
      popoverEls.sizeNumber.value = String(scale);
      const liveCount = mascots.filter((m) => !m.dead).length;
      popoverEls.count.textContent = `${liveCount} active`;
      popoverEls.killGo.disabled = liveCount === 0;
      popoverEls.spawnGo.disabled = liveCount >= MAX_MASCOTS;
    }

    function positionPopover() {
      if (!popover || !toggleBtn) return;
      const rect = toggleBtn.getBoundingClientRect();
      // Anchor: to the right of the toggle button, vertically centred.
      // Clamp so it stays on-screen on narrow viewports.
      const popRect = popover.getBoundingClientRect();
      let left = rect.right + 10;
      let top = rect.top + rect.height / 2 - popRect.height / 2;
      if (left + popRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - popRect.width - 8);
      }
      top = clamp(top, 8, window.innerHeight - popRect.height - 8);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    }

    function openPopover() {
      if (!popover) popover = buildPopover();
      popover.classList.add('is-open');
      popoverOpen = true;
      toggleBtn.setAttribute('aria-expanded', 'true');
      syncPopover();
      popoverEls.on.focus({ preventScroll:true });
      // Position after the panel is rendered so we can measure it.
      requestAnimationFrame(positionPopover);
    }
    function closePopover(returnFocus = false) {
      if (!popover) return;
      popover.classList.remove('is-open');
      popoverOpen = false;
      toggleBtn.setAttribute('aria-expanded', 'false');
      if (returnFocus) toggleBtn.focus({ preventScroll:true });
    }
    function togglePopover() {
      if (popoverOpen) closePopover(); else openPopover();
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePopover();
      });
    }

    // ── Preload sprites then spawn initial mascots ────────────────
    const promises = [];
    for (let i = 1; i <= 46; i++) {
      promises.push(new Promise((res) => {
        const img = new Image();
        spriteImages[i - 1] = img;
        img.decoding = 'sync';
        img.onload = async () => {
          try { await img.decode(); } catch {}
          res();
        };
        img.onerror = () => res();
        img.src = sprite(i);
      }));
    }

    Promise.allSettled(promises).then(() => {
      const initialCount = clamp(loadCount(), 0, MAX_MASCOTS);
      // Always spawn at least one on first visit if enabled, otherwise
      // honour the persisted count exactly (allowing 0 if the user
      // sacrificed everything last session).
      const startCount = initialCount === 0 ? 0 : initialCount;
      for (let i = mascots.length; i < startCount; i++) spawnOne();
      if (mascots.length === 0 && window.shimejisEnabled !== false && initialCount !== 0) {
        spawnOne();
      }

      function tick(t) {
        for (const m of mascots) {
          if (!m.dead) m.update(t);
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  function initWhenReady() {
    const start = () => {
      if (document.getElementById('nyx-shimeji-layer')) return true;
      if (!document.getElementById('nyx-shimeji-toggle')) return false;
      init();
      return true;
    };
    if (start()) return;
    const observer = new MutationObserver(() => {
      if (start()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWhenReady, { once:true });
  } else {
    initWhenReady();
  }
})();
