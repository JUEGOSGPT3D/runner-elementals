/* ============================================================================
   MODULE 2: PLAYER & CONTROLS — PLAYER PLACEHOLDER & HITBOX (player.js)
   Version: v2.3.5
   ============================================================================ */
(function (GameCore, Projection) {
  'use strict';

  // ============================================================================
  // Public API (window.Player — zero allocations per call):
  // - reset() -> resets runtime lane, coordinates, jump, fast-fall, and slide state to default center start
  // - update(dt) -> smoothly moves playerX toward targetLane and advances jump, fast fall, or slide
  // - render(ctx) -> draws ground shadow, standing or sliding body and head, and debug hitbox faces
  // - getHitbox(out) -> writes world-space AABB into out (or shared object) and returns it
  // - moveLane(dir) -> shifts targetLane by -1 or +1 within [MIN_LANE, MAX_LANE]
  // - jump() -> starts a single parabolic jump from ground or cancels an active slide
  // - slide() -> starts a timed slide on ground or triggers airborne fast fall into slide
  // ============================================================================

  if (!GameCore || !Projection) return;

  // World position, lane movement, and jump constants (logical world units / seconds)
  const PLAYER_Z = 60;
  const PLAYER_WORLD_X = 0;
  const MIN_LANE = -1;
  const MAX_LANE = 1;
  const START_LANE = 0;
  const LANE_SPEED = 1400;
  const JUMP_HEIGHT = 168;
  const JUMP_DURATION = 0.5;
  const SLIDE_DURATION = 0.6;
  const FAST_FALL_SPEED = 1400;

  // Hitbox constants (world units, Y = height above ground; Z depths relative to playerZ)
  const HITBOX_MIN_X = -35;
  const HITBOX_MAX_X = 35;
  const HITBOX_MIN_Y = 0;
  const HITBOX_MAX_Y = 126;
  const SLIDE_HITBOX_MAX_Y = 63;
  const HITBOX_DEPTH_NEAR = 15;
  const HITBOX_DEPTH_FAR = 15;

  // Placeholder shape constants (world units)
  const BODY_WIDTH = 70;
  const BODY_HEIGHT = 87;
  const SLIDE_BODY_HEIGHT = 43;
  const HEAD_RADIUS = 20;
  const HEAD_CENTER_Y = 106;
  const SLIDE_HEAD_CENTER_Y = 43;
  const SHADOW_RX = 39;
  const SHADOW_RY = 11;
  const TWO_PI = Math.PI * 2;

  // Frozen flat color palette (gray placeholder tones and non-neon debug hitbox colors)
  const COLORS = Object.freeze({
    shadow: 'rgba(20, 24, 28, 0.35)',
    body: '#8c9094',
    bodyStroke: '#484c50',
    head: '#a8acb0',
    headStroke: '#484c50',
    hitboxBack: '#3898d8',
    hitboxFront: '#e0a030'
  });

  // Preallocated reusable output objects (zero per-frame or per-call allocation)
  const projOut = { x: 0, y: 0, scale: 0 };
  const hitboxOut = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  const debugBox = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };

  // Runtime player coordinates, lane state, jump state, fast-fall state, and slide state
  let targetLane = START_LANE;
  let playerX = PLAYER_WORLD_X;
  let playerZ = PLAYER_Z;
  let isJumping = false;
  let jumpTime = 0;
  let jumpY = 0;
  let isSliding = false;
  let slideTime = 0;
  let isFastFalling = false;

  // Resets runtime player lane, coordinates, jump, fast-fall, and slide state to default center start.
  function reset() {
    targetLane = START_LANE;
    playerX = PLAYER_WORLD_X;
    playerZ = PLAYER_Z;
    isJumping = false;
    jumpTime = 0;
    jumpY = 0;
    isSliding = false;
    slideTime = 0;
    isFastFalling = false;
  }

  // Updates targetLane by -1 or +1 clamped to [MIN_LANE, MAX_LANE], ignoring 0 or non-finite dir.
  function moveLane(dir) {
    if (!Number.isFinite(dir) || dir === 0) return;
    let nextLane = targetLane + (dir > 0 ? 1 : -1);
    if (nextLane < MIN_LANE) nextLane = MIN_LANE;
    if (nextLane > MAX_LANE) nextLane = MAX_LANE;
    if (nextLane === targetLane) return;
    targetLane = nextLane;
  }

  // Starts a parabolic jump from ground or cancels an active slide; ignores calls while airborne.
  function jump() {
    if (isJumping) return;
    if (isSliding) {
      isSliding = false;
      slideTime = 0;
    }
    isJumping = true;
    isFastFalling = false;
    jumpTime = 0;
    jumpY = 0;
  }

  // Starts a timed slide on ground or triggers airborne fast fall into slide; ignores repeat calls.
  function slide() {
    if (isSliding || isFastFalling) return;
    if (isJumping) {
      isFastFalling = true;
    } else {
      isSliding = true;
      slideTime = 0;
    }
  }

  // Smoothly moves playerX toward targetLane and advances any active jump, fast fall, or slide.
  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const targetX = Projection.laneX(targetLane);
    const diff = targetX - playerX;
    if (diff !== 0) {
      const step = LANE_SPEED * dt;
      if (diff > 0) {
        if (diff <= step) {
          playerX = targetX;
        } else {
          playerX += step;
        }
      } else if (-diff <= step) {
        playerX = targetX;
      } else {
        playerX -= step;
      }
    }

    if (isJumping) {
      if (isFastFalling) {
        jumpY -= FAST_FALL_SPEED * dt;
        if (jumpY <= 0) {
          isJumping = false;
          isFastFalling = false;
          jumpTime = 0;
          jumpY = 0;
          isSliding = true;
          slideTime = 0;
        }
      } else {
        jumpTime += dt;
        const u = jumpTime / JUMP_DURATION;
        if (u >= 1) {
          isJumping = false;
          jumpTime = 0;
          jumpY = 0;
        } else {
          jumpY = 4 * JUMP_HEIGHT * u * (1 - u);
        }
      }
    } else if (isSliding) {
      slideTime += dt;
      if (slideTime >= SLIDE_DURATION) {
        isSliding = false;
        slideTime = 0;
      }
    }
  }

  // Writes the player's world-space hitbox bounds into out or hitboxOut without allocating.
  function getHitbox(out) {
    const target = out || hitboxOut;
    target.minX = playerX + HITBOX_MIN_X;
    target.maxX = playerX + HITBOX_MAX_X;
    target.minY = HITBOX_MIN_Y + jumpY;
    target.maxY = (isSliding ? SLIDE_HITBOX_MAX_Y : HITBOX_MAX_Y) + jumpY;
    target.minZ = playerZ - HITBOX_DEPTH_NEAR;
    target.maxZ = playerZ + HITBOX_DEPTH_FAR;
    return target;
  }

  // Renders the player placeholder shadow, body, head, and optional debug hitbox faces.
  function render(ctx) {
    if (!ctx) return;

    Projection.project(playerX, playerZ, projOut);
    const s = projOut.scale;
    if (s <= 0) return;

    // 1. Ground shadow ellipse
    ctx.fillStyle = COLORS.shadow;
    ctx.beginPath();
    ctx.ellipse(projOut.x, projOut.y, SHADOW_RX * s, SHADOW_RY * s, 0, 0, TWO_PI);
    ctx.fill();

    // 2. Body rectangle raised by jumpY above ground at baseY
    const jumpOffsetPx = jumpY * s;
    const baseY = projOut.y - jumpOffsetPx;
    const bodyW = BODY_WIDTH * s;
    const bodyH = (isSliding ? SLIDE_BODY_HEIGHT : BODY_HEIGHT) * s;
    const bodyLeft = projOut.x - bodyW * 0.5;
    const bodyTop = baseY - bodyH;
    ctx.fillStyle = COLORS.body;
    ctx.fillRect(bodyLeft, bodyTop, bodyW, bodyH);
    ctx.strokeStyle = COLORS.bodyStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bodyLeft, bodyTop, bodyW, bodyH);

    // 3. Head circle above body raised by jumpY (top reaches 126 standing or 63 sliding)
    const headR = HEAD_RADIUS * s;
    const headY = baseY - (isSliding ? SLIDE_HEAD_CENTER_Y : HEAD_CENTER_Y) * s;
    ctx.fillStyle = COLORS.head;
    ctx.beginPath();
    ctx.arc(projOut.x, headY, headR, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = COLORS.headStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 4. Debug hitbox back (maxZ) and front (minZ) faces strictly when DEBUG is true
    if (GameCore.isDebug()) {
      getHitbox(debugBox);
      ctx.lineWidth = 1.5;

      // Back face (maxZ)
      Projection.project(playerX, debugBox.maxZ, projOut);
      const sBack = projOut.scale;
      const backLeft = projOut.x + (debugBox.minX - playerX) * sBack;
      const backW = (debugBox.maxX - debugBox.minX) * sBack;
      const backBottom = projOut.y - debugBox.minY * sBack;
      const backH = (debugBox.maxY - debugBox.minY) * sBack;
      ctx.strokeStyle = COLORS.hitboxBack;
      ctx.strokeRect(backLeft, backBottom - backH, backW, backH);

      // Front face (minZ)
      Projection.project(playerX, debugBox.minZ, projOut);
      const sFront = projOut.scale;
      const frontLeft = projOut.x + (debugBox.minX - playerX) * sFront;
      const frontW = (debugBox.maxX - debugBox.minX) * sFront;
      const frontBottom = projOut.y - debugBox.minY * sFront;
      const frontH = (debugBox.maxY - debugBox.minY) * sFront;
      ctx.strokeStyle = COLORS.hitboxFront;
      ctx.strokeRect(frontLeft, frontBottom - frontH, frontW, frontH);
    }
  }

  // Expose frozen public API (strictly 7 methods)
  window.Player = Object.freeze({
    reset: reset,
    update: update,
    render: render,
    getHitbox: getHitbox,
    moveLane: moveLane,
    jump: jump,
    slide: slide
  });
})(window.GameCore, window.Projection);
