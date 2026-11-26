/* ============================================================================
   MODULE 2: PLAYER & CONTROLS — PLAYER PLACEHOLDER & HITBOX (player.js)
   ============================================================================ */
(function (GameCore, Projection) {
  'use strict';

  // ============================================================================
  // Public API (window.Player — zero allocations per call):
  // - reset() -> resets runtime player coordinates to default center lane position
  // - render(ctx) -> draws placeholder shadow, body, head, and debug hitbox faces
  // - getHitbox(out) -> writes world-space AABB into out (or shared object) and returns it
  // ============================================================================

  if (!GameCore || !Projection) return;

  // World position constants (logical world units)
  const PLAYER_Z = 60;
  const PLAYER_WORLD_X = 0;

  // Hitbox constants (world units, Y = height above ground; Z depths relative to playerZ)
  const HITBOX_MIN_X = -25;
  const HITBOX_MAX_X = 25;
  const HITBOX_MIN_Y = 0;
  const HITBOX_MAX_Y = 90;
  const HITBOX_DEPTH_NEAR = 15;
  const HITBOX_DEPTH_FAR = 15;

  // Placeholder shape constants (world units)
  const BODY_WIDTH = 50;
  const BODY_HEIGHT = 62;
  const HEAD_RADIUS = 14;
  const HEAD_CENTER_Y = 76;
  const SHADOW_RX = 28;
  const SHADOW_RY = 8;
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

  // Runtime player coordinates
  let playerX = PLAYER_WORLD_X;
  let playerZ = PLAYER_Z;

  // Resets runtime player coordinates to the default center lane start position.
  function reset() {
    playerX = PLAYER_WORLD_X;
    playerZ = PLAYER_Z;
  }

  // Writes the player's world-space hitbox bounds into out or hitboxOut without allocating.
  function getHitbox(out) {
    const target = out || hitboxOut;
    target.minX = playerX + HITBOX_MIN_X;
    target.maxX = playerX + HITBOX_MAX_X;
    target.minY = HITBOX_MIN_Y;
    target.maxY = HITBOX_MAX_Y;
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

    // 2. Body rectangle centered at projOut.x with bottom at projOut.y
    const bodyW = BODY_WIDTH * s;
    const bodyH = BODY_HEIGHT * s;
    const bodyLeft = projOut.x - bodyW * 0.5;
    const bodyTop = projOut.y - bodyH;
    ctx.fillStyle = COLORS.body;
    ctx.fillRect(bodyLeft, bodyTop, bodyW, bodyH);
    ctx.strokeStyle = COLORS.bodyStroke;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bodyLeft, bodyTop, bodyW, bodyH);

    // 3. Head circle above body (top reaches HEAD_CENTER_Y + HEAD_RADIUS = 90)
    const headR = HEAD_RADIUS * s;
    const headY = projOut.y - HEAD_CENTER_Y * s;
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

  // Expose frozen public API (strictly 3 methods)
  window.Player = Object.freeze({
    reset: reset,
    render: render,
    getHitbox: getHitbox
  });
})(window.GameCore, window.Projection);
