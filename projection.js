/* ============================================================================
   BLOCK B — MODULE 1: PROJECTION (future file: projection.js)
   ============================================================================ */
(function (GameCore) {
  'use strict';

  // ============================================================================
  // Pseudo-3D Projection Formulas (all coordinates in logical 360x640 space):
  // - scale(z)         = 1 / (1 + z / Z_FOCAL)  (returns 0 if 1 + z / Z_FOCAL <= 0)
  // - y(z)             = HORIZON_Y + (GAME_HEIGHT - HORIZON_Y) * scale(z)
  // - x(worldX, z)     = CENTER_X + worldX * scale(z)
  // - laneX(laneIndex) = laneIndex * LANE_WIDTH  (laneIndex: -1, 0, +1)
  //
  // Projection Rules:
  // - Near/Far Clip Rule: Only depths with Z_NEAR <= z <= Z_FAR are drawable
  //   (Projection.isDrawable(z)). Callers MUST skip anything not drawable.
  // - Discrete Fog Rule: Projection.fogLevel(z) returns integer 0..3 from
  //   FOG_START (600) to Z_FAR (1500), with 0 for z <= FOG_START and 3 at Z_FAR.
  // - Draw-Order Rule: Always draw projected objects far-to-near (z descending)
  //   so closer elements naturally overlap farther ones.
  //
  // Public API (window.Projection — zero allocations per call):
  // - scaleAt(z) -> returns perspective scale at depth z (never NaN or Infinity)
  // - yAt(z) -> returns logical screen Y coordinate for depth z
  // - laneX(laneIndex) -> returns world X center coordinate for the given lane index
  // - project(worldX, z, out) -> writes { x, y, scale } into out (or shared object) and returns it
  // - zAtScreenY(y) -> inverse of yAt (returns Z_FAR if y <= HORIZON_Y, 0 if y >= GAME_HEIGHT)
  // - isDrawable(z) -> returns true only when z is finite and Z_NEAR <= z <= Z_FAR
  // - fogLevel(z) -> returns discrete integer fog level 0..3 for depth z
  // - getConfig() -> returns frozen read-only object with all projection constants
  // ============================================================================

  // Tunable projection constants in logical 360x640 units
  const GAME_HEIGHT = GameCore ? GameCore.getLogicalSize().height : 640;
  const HORIZON_Y = 210;
  const CENTER_X = 180;
  const LANE_COUNT = 3;
  const LANE_WIDTH = 100;
  const Z_FOCAL = 300;
  const Z_FAR = 1500;
  const Z_NEAR = -120;
  const FOG_START = 600;
  const FOG_LEVELS = 4;
  const ROAD_SPAN_Y = GAME_HEIGHT - HORIZON_Y;
  const FOG_SPAN_Z = Z_FAR - FOG_START;
  const FOG_MAX_INDEX = FOG_LEVELS - 1;

  // Pre-frozen read-only configuration object and reusable output object
  const CONFIG = Object.freeze({
    HORIZON_Y: HORIZON_Y,
    CENTER_X: CENTER_X,
    LANE_COUNT: LANE_COUNT,
    LANE_WIDTH: LANE_WIDTH,
    Z_FOCAL: Z_FOCAL,
    Z_FAR: Z_FAR,
    Z_NEAR: Z_NEAR,
    FOG_START: FOG_START,
    FOG_LEVELS: FOG_LEVELS
  });
  const defaultOut = { x: 0, y: 0, scale: 0 };

  // Computes perspective scale at depth z, returning 0 if non-finite or behind singularity.
  function scaleAt(z) {
    if (!Number.isFinite(z)) return 0;
    const denom = 1 + z / Z_FOCAL;
    if (denom <= 0) return 0;
    return 1 / denom;
  }

  // Computes logical screen Y coordinate for depth z.
  function yAt(z) {
    return HORIZON_Y + ROAD_SPAN_Y * scaleAt(z);
  }

  // Computes world X center coordinate for lane index (-1, 0, +1).
  function laneX(laneIndex) {
    return laneIndex * LANE_WIDTH;
  }

  // Projects (worldX, z) into logical { x, y, scale } using out or shared object without allocating.
  function project(worldX, z, out) {
    const target = out || defaultOut;
    const s = scaleAt(z);
    target.x = CENTER_X + worldX * s;
    target.y = HORIZON_Y + ROAD_SPAN_Y * s;
    target.scale = s;
    return target;
  }

  // Computes depth z from logical screen Y (Z_FAR if y <= HORIZON_Y, 0 if y >= GAME_HEIGHT).
  function zAtScreenY(y) {
    if (!Number.isFinite(y) || y <= HORIZON_Y) return Z_FAR;
    if (y >= GAME_HEIGHT) return 0;
    return Z_FOCAL * (ROAD_SPAN_Y / (y - HORIZON_Y) - 1);
  }

  // Returns true only when z is finite and within [Z_NEAR, Z_FAR].
  function isDrawable(z) {
    return Number.isFinite(z) && z >= Z_NEAR && z <= Z_FAR;
  }

  // Returns discrete integer fog level 0..3 from FOG_START (600) to Z_FAR (1500).
  function fogLevel(z) {
    if (!Number.isFinite(z) || z <= FOG_START) return 0;
    if (z >= Z_FAR) return FOG_MAX_INDEX;
    const level = Math.round(((z - FOG_START) / FOG_SPAN_Z) * FOG_MAX_INDEX);
    return level < 0 ? 0 : (level > FOG_MAX_INDEX ? FOG_MAX_INDEX : level);
  }

  // Returns the pre-frozen read-only object containing all projection constants.
  function getConfig() {
    return CONFIG;
  }

  // Expose frozen public API for all Modules
  window.Projection = Object.freeze({
    scaleAt: scaleAt,
    yAt: yAt,
    laneX: laneX,
    project: project,
    zAtScreenY: zAtScreenY,
    isDrawable: isDrawable,
    fogLevel: fogLevel,
    getConfig: getConfig
  });
})(window.GameCore);
