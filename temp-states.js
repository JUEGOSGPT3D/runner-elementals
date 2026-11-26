/* ============================================================================
   BLOCK C — TEMPORARY STATES (to be replaced by later Modules)
   Version: v2.3.5
   ============================================================================ */
(function (GameCore, Projection) {
  'use strict';

  // ============================================================================
  // TEMPORARY BLOCK — How Module 2 (Player & Controls) and Module 4 (UI/UX)
  // replace these placeholder states:
  // 1. Register real MENU, PLAYING, and GAMEOVER handlers via GameCore.registerState.
  // 2. Call window.TempStates.dispose() to remove the temporary pointerdown
  //    listener, clear extra debug text, and reset temporary flags cleanly.
  // ============================================================================

  if (!GameCore || !Projection) return;

  // Static configuration read once at startup
  const logicalSize = GameCore.getLogicalSize();
  const GAME_WIDTH = logicalSize.width;
  const GAME_HEIGHT = logicalSize.height;
  const projCfg = Projection.getConfig();
  const HORIZON_Y = projCfg.HORIZON_Y;
  const CENTER_X = projCfg.CENTER_X;
  const LANE_WIDTH = projCfg.LANE_WIDTH;
  const Z_FAR = projCfg.Z_FAR;
  const FOG_LEVELS = projCfg.FOG_LEVELS;

  // Precomputed horizon fog and ground fade-band geometry (4 equal bands from yAt(1500) to yAt(900))
  const Y_FAR = Projection.yAt(Z_FAR);
  const Y_FADE_END = Projection.yAt(900);
  const FADE_BAND_COUNT = 4;
  const FADE_BAND_STEP = (Y_FADE_END - Y_FAR) / FADE_BAND_COUNT;
  const FADE_EDGES = Object.freeze([
    Y_FAR,
    Y_FAR + FADE_BAND_STEP,
    Y_FAR + FADE_BAND_STEP * 2,
    Y_FAR + FADE_BAND_STEP * 3,
    Y_FADE_END
  ]);
  const FOG_BAND_HEIGHT = Y_FAR - HORIZON_Y + 0.5;

  // Temporary road, scenery, and input constants
  const STRIPE_SPACING = 120;
  const SCROLL_SPEED = 400;
  const SCENERY_SPACING = 300;
  const SCENERY_HALF_STEP = 150;
  const SCENERY_GROW_Z = 200;
  const SCENERY_BASE_WIDTH = 36;
  const SCENERY_BASE_HEIGHT = 70;
  const MARKER_BASE_SIZE = 40;
  const TAP_DEBOUNCE_MS = 250;
  const ROAD_HALF_WIDTH = 1.5 * LANE_WIDTH;
  const DIVIDER_X_LEFT = -0.5 * LANE_WIDTH;
  const DIVIDER_X_RIGHT = 0.5 * LANE_WIDTH;
  const HAZE_BAND_HEIGHT = 8;
  const DEBUG_MARKER_LANES = Object.freeze([-1, 0, 1]);
  const DEBUG_MARKER_ZS = Object.freeze([1400, 900, 500, 200, 0]);

  // Discrete fog mix strengths (level 3 raised to 0.95 to soften far road-to-fog transition)
  const FOG_MIX_FACTORS = Object.freeze([0.0, 0.32, 0.65, 0.95]);
  const FADE_MIX_FACTORS = Object.freeze([0.75, 0.55, 0.35, 0.15]);
  const HAZE_MIX_FACTORS = Object.freeze([0.65, 0.40, 0.18]);
  const LANE_SEGMENTS = Object.freeze([
    Object.freeze({ zNear: 1350, zFar: 1500, level: 3 }),
    Object.freeze({ zNear: 1050, zFar: 1350, level: 2 }),
    Object.freeze({ zNear: 750, zFar: 1050, level: 1 }),
    Object.freeze({ zNear: 0, zFar: 750, level: 0 })
  ]);

  // Single biome table and muted organic temporary palettes (NO neon colors)
  const BIOME_NAMES = Object.freeze(['vegetation', 'lava', 'desert', 'ice']);
  const BIOME_LABELS = Object.freeze({
    vegetation: 'Biome: vegetation',
    lava: 'Biome: lava',
    desert: 'Biome: desert',
    ice: 'Biome: ice'
  });

  const BIOME_TEMP_PALETTES = Object.freeze({
    vegetation: Object.freeze({
      sky: '#6f7e82',
      ground: '#525f43',
      road: '#625c51',
      stripeA: '#6b6558',
      stripeB: '#575247',
      laneLine: '#9e9784',
      scenery: '#39462f',
      fog: '#8b948c'
    }),
    lava: Object.freeze({
      sky: '#564d4a',
      ground: '#3f3532',
      road: '#514845',
      stripeA: '#5c4e48',
      stripeB: '#463e3b',
      laneLine: '#927262',
      scenery: '#2d2422',
      fog: '#6e605a'
    }),
    desert: Object.freeze({
      sky: '#8b9294',
      ground: '#988565',
      road: '#7f6f57',
      stripeA: '#89785e',
      stripeB: '#74654f',
      laneLine: '#b8a98c',
      scenery: '#66523b',
      fog: '#b2a68e'
    }),
    ice: Object.freeze({
      sky: '#75848f',
      ground: '#8b989e',
      road: '#66747e',
      stripeA: '#72808b',
      stripeB: '#5c6972',
      laneLine: '#aec0ca',
      scenery: '#4c5e6b',
      fog: '#9faeb8'
    })
  });

  // Muted neutral palette for temporary UI labels, pause overlay, and debug markers
  const TEMP_UI_PALETTE = Object.freeze({
    panelBg: 'rgba(18, 22, 24, 0.72)',
    panelBorder: '#8c9499',
    textPrimary: '#f2f0ea',
    textSecondary: '#d6d2c8',
    textMuted: '#cfc8b8',
    pauseBackdrop: 'rgba(16, 20, 22, 0.72)',
    pauseBoxBg: '#2b3035',
    markerFill: '#ddd2bc',
    markerStroke: '#2e2b26'
  });

  // Parses a 6-digit #rrggbb hex string into RGB channels during startup precomputation.
  function parseHexColor(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  // Mixes two #rrggbb hex colors by factor (0..1) and returns a #rrggbb string (startup only).
  function mixHexColor(hexA, hexB, factor) {
    const a = parseHexColor(hexA);
    const b = parseHexColor(hexB);
    const r = Math.round(a[0] + (b[0] - a[0]) * factor);
    const g = Math.round(a[1] + (b[1] - a[1]) * factor);
    const bl = Math.round(a[2] + (b[2] - a[2]) * factor);
    const hex = ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
    return '#' + hex;
  }

  // Precomputes a frozen ramp of mixed colors for a given array of blend factors (startup only).
  function buildMixRamp(baseHex, targetHex, factors) {
    const ramp = new Array(factors.length);
    for (let i = 0; i < factors.length; i++) {
      ramp[i] = mixHexColor(baseHex, targetHex, factors[i]);
    }
    return Object.freeze(ramp);
  }

  // Precomputes all biome fog levels, ground fade bands, and sky haze bands once at startup.
  function buildAllBiomeFogTables() {
    const tables = Object.create(null);
    for (let i = 0; i < BIOME_NAMES.length; i++) {
      const name = BIOME_NAMES[i];
      const p = BIOME_TEMP_PALETTES[name];
      tables[name] = Object.freeze({
        sky: p.sky,
        ground: p.ground,
        fog: p.fog,
        groundFade: buildMixRamp(p.ground, p.fog, FADE_MIX_FACTORS),
        skyHaze: buildMixRamp(p.sky, p.fog, HAZE_MIX_FACTORS),
        road: buildMixRamp(p.road, p.fog, FOG_MIX_FACTORS),
        stripeA: buildMixRamp(p.stripeA, p.fog, FOG_MIX_FACTORS),
        stripeB: buildMixRamp(p.stripeB, p.fog, FOG_MIX_FACTORS),
        laneLine: buildMixRamp(p.laneLine, p.fog, FOG_MIX_FACTORS),
        scenery: buildMixRamp(p.scenery, p.fog, FOG_MIX_FACTORS)
      });
    }
    return Object.freeze(tables);
  }

  // Precomputed lookup table for every biome (zero per-frame color math or allocation)
  const BIOME_FOG_TABLES = buildAllBiomeFogTables();

  // DOM reference and reusable projection output object
  const canvas = document.getElementById('gameCanvas');
  const projOut = { x: 0, y: 0, scale: 0 };

  // Temporary state runtime variables
  let listenerAttached = false;
  let lastTapTime = 0;
  let currentBiome = 'vegetation';
  let activeBiomeTable = BIOME_FOG_TABLES.vegetation;
  let stripeOffset = 0;
  let stripeParity = 0;
  let sceneryOffset = 0;
  let sceneryParity = 0;
  let runTime = 0;
  let finalRunTime = 0;
  let lastTenths = 0;
  let cachedTimeLabel = 'Time: 0.0s';
  let cachedFinalTimeLabel = 'Time: 0.0s';
  let sceneryDrawn = 0;
  let scenerySkipped = 0;
  let lastDebugBiome = '';
  let lastDebugDrawn = -1;
  let lastDebugSkipped = -1;

  // Single biome decision point: chooses one biome at random with zero runtime allocation.
  function chooseBiome() {
    const index = Math.floor(Math.random() * BIOME_NAMES.length);
    currentBiome = BIOME_NAMES[index];
    activeBiomeTable = BIOME_FOG_TABLES[currentBiome];
    return currentBiome;
  }

  // Draws sky, ground fade bands, road, far-to-near fogged stripes, lane dividers, and horizon fog.
  function drawTestRoad(ctx) {
    const tbl = activeBiomeTable;

    // 1. Flat sky and base ground fills
    ctx.fillStyle = tbl.sky;
    ctx.fillRect(0, 0, GAME_WIDTH, HORIZON_Y);
    ctx.fillStyle = tbl.ground;
    ctx.fillRect(0, HORIZON_Y, GAME_WIDTH, GAME_HEIGHT - HORIZON_Y);

    // 2. Four equal-height flat ground fade bands from yAt(1500) to yAt(900) BEFORE road and stripes
    for (let b = 0; b < FADE_BAND_COUNT; b++) {
      const bandTop = FADE_EDGES[b];
      const bandHeight = (FADE_EDGES[b + 1] - bandTop) + 0.5;
      ctx.fillStyle = tbl.groundFade[b];
      ctx.fillRect(0, bandTop, GAME_WIDTH, bandHeight);
    }

    // 3. Base road trapezoid using far fog tone to prevent subpixel bright seams
    const s0 = Projection.scaleAt(0);
    const y0 = Projection.yAt(0);
    const sFar = Projection.scaleAt(Z_FAR);
    const halfRoadNear = ROAD_HALF_WIDTH * s0;
    const halfRoadFar = ROAD_HALF_WIDTH * sFar;

    ctx.fillStyle = tbl.road[FOG_LEVELS - 1];
    ctx.beginPath();
    ctx.moveTo(CENTER_X - halfRoadNear, y0);
    ctx.lineTo(CENTER_X + halfRoadNear, y0);
    ctx.lineTo(CENTER_X + halfRoadFar, Y_FAR);
    ctx.lineTo(CENTER_X - halfRoadFar, Y_FAR);
    ctx.closePath();
    ctx.fill();

    // 4. Alternating depth stripes drawn strictly FAR TO NEAR with precomputed discrete fog
    for (let i = 13; i >= 0; i--) {
      let zA = i * STRIPE_SPACING - stripeOffset;
      let zB = zA + STRIPE_SPACING;

      if (zB <= 0 || zA >= Z_FAR) continue;
      if (zA < 0) zA = 0;
      if (zB > Z_FAR) zB = Z_FAR;

      const sA = Projection.scaleAt(zA);
      const yA = Projection.yAt(zA);
      const sB = Projection.scaleAt(zB);
      const yB = Projection.yAt(zB);
      const halfA = ROAD_HALF_WIDTH * sA;
      const halfB = ROAD_HALF_WIDTH * sB;
      const fogLvl = Projection.fogLevel((zA + zB) * 0.5);

      ctx.fillStyle = ((i + stripeParity) & 1) === 0 ? tbl.stripeA[fogLvl] : tbl.stripeB[fogLvl];
      ctx.beginPath();
      ctx.moveTo(CENTER_X - halfA, yA);
      ctx.lineTo(CENTER_X + halfA, yA);
      ctx.lineTo(CENTER_X + halfB, yB);
      ctx.lineTo(CENTER_X - halfB, yB);
      ctx.closePath();
      ctx.fill();
    }

    // 5. Two lane dividers drawn far-to-near per discrete fog depth band
    ctx.lineWidth = 2;
    for (let segIdx = 0; segIdx < LANE_SEGMENTS.length; segIdx++) {
      const seg = LANE_SEGMENTS[segIdx];
      const sSegNear = Projection.scaleAt(seg.zNear);
      const ySegNear = Projection.yAt(seg.zNear);
      const sSegFar = Projection.scaleAt(seg.zFar);
      const ySegFar = Projection.yAt(seg.zFar);

      ctx.strokeStyle = tbl.laneLine[seg.level];
      ctx.beginPath();
      ctx.moveTo(CENTER_X + DIVIDER_X_LEFT * sSegNear, ySegNear);
      ctx.lineTo(CENTER_X + DIVIDER_X_LEFT * sSegFar, ySegFar);
      ctx.moveTo(CENTER_X + DIVIDER_X_RIGHT * sSegNear, ySegNear);
      ctx.lineTo(CENTER_X + DIVIDER_X_RIGHT * sSegFar, ySegFar);
      ctx.stroke();
    }

    // 6. Flat biome fog band covering HORIZON_Y to Y_FAR (+0.5px) on top of the far edge
    ctx.fillStyle = tbl.fog;
    ctx.fillRect(0, HORIZON_Y, GAME_WIDTH, FOG_BAND_HEIGHT);

    // 7. Three flat sky-haze bands above HORIZON_Y (height 8 each, decreasing strength upward)
    ctx.fillStyle = tbl.skyHaze[0];
    ctx.fillRect(0, HORIZON_Y - HAZE_BAND_HEIGHT, GAME_WIDTH, HAZE_BAND_HEIGHT);
    ctx.fillStyle = tbl.skyHaze[1];
    ctx.fillRect(0, HORIZON_Y - HAZE_BAND_HEIGHT * 2, GAME_WIDTH, HAZE_BAND_HEIGHT);
    ctx.fillStyle = tbl.skyHaze[2];
    ctx.fillRect(0, HORIZON_Y - HAZE_BAND_HEIGHT * 3, GAME_WIDTH, HAZE_BAND_HEIGHT);

    // 8. Subtle horizon line at HORIZON_Y
    ctx.strokeStyle = tbl.skyHaze[0];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y);
    ctx.lineTo(GAME_WIDTH, HORIZON_Y);
    ctx.stroke();
  }

  // Draws one debug scenery box if drawable, grown > 0, and horizontally inside 360x640.
  function drawSceneryCandidate(ctx, worldX, z) {
    if (!Projection.isDrawable(z)) {
      scenerySkipped += 1;
      return;
    }

    let growFactor = (Z_FAR - z) / SCENERY_GROW_Z;
    if (growFactor <= 0) {
      scenerySkipped += 1;
      return;
    }
    if (growFactor > 1) {
      growFactor = 1;
    }

    Projection.project(worldX, z, projOut);
    const w = SCENERY_BASE_WIDTH * projOut.scale;
    const h = SCENERY_BASE_HEIGHT * projOut.scale * growFactor;
    const left = projOut.x - w * 0.5;
    const top = projOut.y - h;

    if (left + w < 0 || left > GAME_WIDTH) {
      scenerySkipped += 1;
      return;
    }

    const fogLvl = Projection.fogLevel(z);
    ctx.fillStyle = activeBiomeTable.scenery[fogLvl];
    ctx.fillRect(left, top, w, h);
    sceneryDrawn += 1;
  }

  // Draws debug-only scenery boxes and lane markers far-to-near and updates cached debug extra text.
  function drawDebugWorldGuides(ctx) {
    if (!GameCore.isDebug()) return;

    // 1. Roadside scenery boxes at +/-260 and +/-420 drawn strictly FAR TO NEAR
    sceneryDrawn = 0;
    scenerySkipped = 0;

    for (let k = 5; k >= 0; k--) {
      const isEven = ((k + sceneryParity) & 1) === 0;
      const zOuter = k * SCENERY_SPACING + SCENERY_HALF_STEP - sceneryOffset;
      const xOuter = isEven ? 420 : -420;
      drawSceneryCandidate(ctx, xOuter, zOuter);

      const zInner = k * SCENERY_SPACING - sceneryOffset;
      const xInner = isEven ? -260 : 260;
      drawSceneryCandidate(ctx, xInner, zInner);
    }

    // 2. Perspective lane markers drawn strictly FAR TO NEAR
    ctx.fillStyle = TEMP_UI_PALETTE.markerFill;
    ctx.strokeStyle = TEMP_UI_PALETTE.markerStroke;

    for (let zi = 0; zi < DEBUG_MARKER_ZS.length; zi++) {
      const z = DEBUG_MARKER_ZS[zi];
      const size = MARKER_BASE_SIZE * Projection.scaleAt(z);
      const halfSize = size * 0.5;
      ctx.lineWidth = size > 12 ? 1.5 : 1;

      for (let li = 0; li < DEBUG_MARKER_LANES.length; li++) {
        Projection.project(Projection.laneX(DEBUG_MARKER_LANES[li]), z, projOut);
        const drawX = projOut.x - halfSize;
        const drawY = projOut.y - size;
        ctx.fillRect(drawX, drawY, size, size);
        ctx.strokeRect(drawX, drawY, size, size);
      }
    }

    // 3. Push extra debug text only when biome or drawn/skipped counts change
    if (
      currentBiome !== lastDebugBiome ||
      sceneryDrawn !== lastDebugDrawn ||
      scenerySkipped !== lastDebugSkipped
    ) {
      lastDebugBiome = currentBiome;
      lastDebugDrawn = sceneryDrawn;
      lastDebugSkipped = scenerySkipped;
      GameCore.setDebugExtra(
        'Proj: H=210 F=300 N=-120 Far=1500 Fog=4\nBiome: ' +
        currentBiome +
        ' | Boxes: ' +
        sceneryDrawn +
        ' draw / ' +
        scenerySkipped +
        ' skip'
      );
    }
  }

  // Routes horizontal swipes to Player.moveLane and upward swipes to Player.jump during unpaused PLAYING.
  function onPlayingSwipe(dirX, dirY) {
    if (GameCore.getState() !== 'PLAYING' || GameCore.isPaused()) return;
    if (!window.Player) return;
    if (dirX !== 0) {
      window.Player.moveLane(dirX);
    } else if (dirY === -1) {
      window.Player.jump();
    } else if (dirY === 1) {
      window.Player.slide();
    }
  }

  // Handles debounced taps during unpaused PLAYING to transition to GAMEOVER.
  function onPlayingTap() {
    if (GameCore.isPaused()) return;
    const now = performance.now();
    if (lastTapTime > 0 && now - lastTapTime < TAP_DEBOUNCE_MS) return;
    lastTapTime = now;
    GameCore.setState('GAMEOVER');
  }

  // Preallocated handler table passed to Input.setHandlers on entering PLAYING
  const playingInputHandlers = Object.freeze({
    swipe: onPlayingSwipe,
    tap: onPlayingTap
  });

  // Picks one biome per run and resets scroll offsets and run timer on entering PLAYING.
  function onPlayingEnter() {
    chooseBiome();
    stripeOffset = 0;
    stripeParity = 0;
    sceneryOffset = 0;
    sceneryParity = 0;
    runTime = 0;
    lastTenths = 0;
    cachedTimeLabel = 'Time: 0.0s';
    if (window.Player) {
      window.Player.reset();
    }
    if (window.Input) {
      window.Input.setHandlers(playingInputHandlers);
      window.Input.enable();
    }
  }

  // Captures and caches the final formatted run time when leaving PLAYING.
  function onPlayingExit() {
    finalRunTime = runTime;
    cachedFinalTimeLabel = 'Time: ' + finalRunTime.toFixed(1) + 's';
    if (window.Input) {
      window.Input.disable();
      window.Input.setHandlers(null);
    }
  }

  // Advances road stripe offset, scenery offset, and run timer using dt.
  function updatePlaying(dt) {
    const deltaZ = SCROLL_SPEED * dt;

    stripeOffset += deltaZ;
    if (stripeOffset >= STRIPE_SPACING) {
      const stripeWraps = Math.floor(stripeOffset / STRIPE_SPACING);
      stripeOffset -= stripeWraps * STRIPE_SPACING;
      if ((stripeWraps & 1) === 1) {
        stripeParity ^= 1;
      }
    }

    sceneryOffset += deltaZ;
    if (sceneryOffset >= SCENERY_SPACING) {
      const sceneryWraps = Math.floor(sceneryOffset / SCENERY_SPACING);
      sceneryOffset -= sceneryWraps * SCENERY_SPACING;
      if ((sceneryWraps & 1) === 1) {
        sceneryParity ^= 1;
      }
    }

    runTime += dt;
    const tenths = Math.floor(runTime * 10);
    if (tenths !== lastTenths) {
      lastTenths = tenths;
      cachedTimeLabel = 'Time: ' + (tenths / 10).toFixed(1) + 's';
    }

    if (window.Player) {
      window.Player.update(dt);
    }
  }

  // Renders static test road, optional debug guides, and temporary centered MENU text.
  function renderMenu(ctx) {
    drawTestRoad(ctx);
    drawDebugWorldGuides(ctx);

    const boxW = 240;
    const boxH = 104;
    const boxX = (GAME_WIDTH - boxW) / 2;
    const boxY = (GAME_HEIGHT - boxH) / 2;

    ctx.fillStyle = TEMP_UI_PALETTE.panelBg;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = TEMP_UI_PALETTE.panelBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = TEMP_UI_PALETTE.textPrimary;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('MENU', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 16);

    ctx.fillStyle = TEMP_UI_PALETTE.textSecondary;
    ctx.font = '17px sans-serif';
    ctx.fillText('Tap to start', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 24);
  }

  // Renders scrolling test road, optional debug guides, temporary PLAYING HUD, and pause overlay.
  function renderPlaying(ctx) {
    drawTestRoad(ctx);
    drawDebugWorldGuides(ctx);
    if (window.Player) {
      window.Player.render(ctx);
    }

    const hudY = GameCore.isDebug() ? 118 : 18;
    const hudW = GAME_WIDTH - 140;
    const hudH = 72;
    const hudX = (GAME_WIDTH - hudW) / 2;

    ctx.fillStyle = TEMP_UI_PALETTE.panelBg;
    ctx.fillRect(hudX, hudY, hudW, hudH);
    ctx.strokeStyle = TEMP_UI_PALETTE.panelBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(hudX, hudY, hudW, hudH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = TEMP_UI_PALETTE.textPrimary;
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('PLAYING', GAME_WIDTH / 2, hudY + 16);

    ctx.fillStyle = TEMP_UI_PALETTE.textMuted;
    ctx.font = '16px monospace';
    ctx.fillText(cachedTimeLabel, GAME_WIDTH / 2, hudY + 38);

    ctx.fillStyle = TEMP_UI_PALETTE.textSecondary;
    ctx.font = '13px sans-serif';
    ctx.fillText(BIOME_LABELS[currentBiome], GAME_WIDTH / 2, hudY + 58);

    // TEMPORARY pause overlay (real pause UI belongs to Module 4)
    if (GameCore.isPaused()) {
      ctx.fillStyle = TEMP_UI_PALETTE.pauseBackdrop;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      const boxW = GAME_WIDTH - 48;
      const boxH = 64;
      const boxX = 24;
      const boxY = (GAME_HEIGHT - boxH) / 2;

      ctx.fillStyle = TEMP_UI_PALETTE.pauseBoxBg;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = TEMP_UI_PALETTE.panelBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.fillStyle = TEMP_UI_PALETTE.textPrimary;
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText('PAUSED - tap to resume', GAME_WIDTH / 2, GAME_HEIGHT / 2);
    }
  }

  // Renders static test road, optional debug guides, and temporary centered GAMEOVER text.
  function renderGameOver(ctx) {
    drawTestRoad(ctx);
    drawDebugWorldGuides(ctx);

    const boxW = 264;
    const boxH = 136;
    const boxX = (GAME_WIDTH - boxW) / 2;
    const boxY = (GAME_HEIGHT - boxH) / 2;

    ctx.fillStyle = TEMP_UI_PALETTE.panelBg;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = TEMP_UI_PALETTE.panelBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = TEMP_UI_PALETTE.textPrimary;
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('GAME OVER', GAME_WIDTH / 2, GAME_HEIGHT / 2 - 36);

    ctx.fillStyle = TEMP_UI_PALETTE.textMuted;
    ctx.font = '18px monospace';
    ctx.fillText(cachedFinalTimeLabel, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 2);

    ctx.fillStyle = TEMP_UI_PALETTE.textSecondary;
    ctx.font = '16px sans-serif';
    ctx.fillText('Tap to return to menu', GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40);
  }

  // Handles temporary pointerdown taps with 250ms debounce to resume pause or cycle states.
  function handleTempPointerDown(event) {
    if (!event.isPrimary) return;

    const active = GameCore.getState();
    if (active === 'PLAYING' && !GameCore.isPaused()) return;

    event.preventDefault();

    if (active === 'PLAYING' && GameCore.isPaused()) {
      event.stopImmediatePropagation();
    }

    const now = performance.now();
    if (lastTapTime > 0 && now - lastTapTime < TAP_DEBOUNCE_MS) return;
    lastTapTime = now;

    if (GameCore.isPaused()) {
      GameCore.resume();
      return;
    }

    if (active === 'MENU') {
      GameCore.setState('PLAYING');
    } else if (active === 'PLAYING') {
      GameCore.setState('GAMEOVER');
    } else {
      GameCore.setState('MENU');
    }
  }

  // Removes the temporary pointerdown listener, clears extra debug text, and resets flags cleanly.
  function dispose() {
    if (listenerAttached && canvas) {
      canvas.removeEventListener('pointerdown', handleTempPointerDown);
    }
    listenerAttached = false;
    lastTapTime = 0;
    stripeOffset = 0;
    stripeParity = 0;
    sceneryOffset = 0;
    sceneryParity = 0;
    runTime = 0;
    finalRunTime = 0;
    lastTenths = 0;
    cachedTimeLabel = 'Time: 0.0s';
    cachedFinalTimeLabel = 'Time: 0.0s';
    sceneryDrawn = 0;
    scenerySkipped = 0;
    lastDebugBiome = '';
    lastDebugDrawn = -1;
    lastDebugSkipped = -1;
    GameCore.setDebugExtra('');
  }

  // Registers MENU, PLAYING, and GAMEOVER temporary states and binds the tap listener once.
  function initTempStates() {
    GameCore.registerState('MENU', {
      render: renderMenu,
      pausable: false
    });

    GameCore.registerState('PLAYING', {
      enter: onPlayingEnter,
      exit: onPlayingExit,
      update: updatePlaying,
      render: renderPlaying,
      pausable: true
    });

    GameCore.registerState('GAMEOVER', {
      render: renderGameOver,
      pausable: false
    });

    GameCore.setState('MENU');

    if (!listenerAttached && canvas) {
      listenerAttached = true;
      canvas.addEventListener('pointerdown', handleTempPointerDown);
    }
  }

  // Expose cleanup handle for Module 2 and Module 4
  window.TempStates = Object.freeze({
    dispose: dispose
  });

  initTempStates();
})(window.GameCore, window.Projection);
