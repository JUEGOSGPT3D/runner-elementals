/* ============================================================================
   BLOCK A — MODULE 1: CORE (future file: game.js)
   Version: v2.3.5
   ============================================================================ */
(function () {
  'use strict';

  // ============================================================================
  // Public API (window.GameCore):
  // - getScale() -> returns number (uniform "contain" scale from 360x640 to CSS px)
  // - getOffset() -> returns reusable { x, y } offset of logical 360x640 area in CSS px
  // - screenToGame(clientX, clientY, out) -> writes/returns logical { x, y } in 360x640 space
  // - getSafeArea() -> returns reusable { top, right, bottom, left } safe-area insets in CSS px
  // - getLogicalSize() -> returns frozen { width: 360, height: 640 } logical dimensions
  // - getState() -> returns active state name string or null
  // - setState(name) -> switches to registered state (queued mid-frame, immediate otherwise); ignores unknown
  // - registerState(name, handlers) -> registers or replaces state handlers and refreshes state list
  // - unregisterState(name) -> removes registered state; refuses removal of active or queued state
  // - isPaused() -> returns boolean indicating whether updates are paused
  // - pause() -> sets paused=true only when active state declares pausable === true
  // - resume() -> sets paused=false and resets lastTimestamp to prevent a dt jump
  // - isDebug() -> returns boolean DEBUG flag (true only when URL has ?debug=1)
  // - setDebugExtra(text) -> caches extra debug line(s) rendered in debug panel when DEBUG is true
  //
  // State handlers format passed to registerState(name, handlers):
  // - enter(prevName): optional function invoked right after entering the state
  // - exit(nextName): optional function invoked right before leaving the state
  // - update(dt): optional function invoked each unpaused frame with dt clamped to MAX_DT
  // - render(ctx): optional function invoked each frame inside clipped 360x640 space
  // - pausable: optional boolean (default false) allowing pause() and auto-pause
  // ============================================================================

  // Core constants
  const APP_VERSION = 'v2.3.5';
  const GAME_WIDTH = 360;
  const GAME_HEIGHT = 640;
  const MAX_CANVAS_PIXELS = 1000000;
  const MAX_DT = 0.1;
  const SLOW_FRAME_MS = 50;
  const RESUME_GAP_MS = 1000;
  const ERROR_LOG_INTERVAL_MS = 1000;
  const FPS_UPDATE_INTERVAL_MS = 500;
  const BORDER_WIDTH = 6;
  const CORNER_SIZE = 12;
  const CORNER_LINE_WIDTH = 2;
  const DEBUG = (new URLSearchParams(window.location.search).get('debug') === '1');

  // Muted natural temporary palette for core guides and debug overlay (no neon)
  const TEMP_PALETTE = Object.freeze({
    outerBg: '#121826',
    border: '#8fa399',
    corner: '#d8dfd6',
    debugBg: 'rgba(15, 20, 18, 0.78)',
    debugText: '#e5ece6'
  });

  // Pre-frozen logical dimensions and reusable return objects (zero per-call allocation)
  const LOGICAL_SIZE = Object.freeze({ width: GAME_WIDTH, height: GAME_HEIGHT });
  const offsetOut = { x: 0, y: 0 };
  const screenToGameOut = { x: 0, y: 0 };
  const safeAreaOut = { top: 0, right: 0, bottom: 0, left: 0 };

  // DOM references
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas ? canvas.getContext('2d') : null;
  const safeAreaProbeEl = document.getElementById('safeAreaProbe');

  // Canvas save/restore stack guard state
  let origSave = null;
  let origRestore = null;
  let trackingStateSaves = false;
  let stateSaveDepth = 0;

  // Viewport, scaling, and safe-area state
  let layoutDirty = false;
  let viewportWidth = 0;
  let viewportHeight = 0;
  let vpOffsetX = 0;
  let vpOffsetY = 0;
  let dpr = 1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let canvasPixelWidth = 0;
  let canvasPixelHeight = 0;

  // Cached layout signature to skip redundant canvas resizes
  let hasLayoutInitialized = false;
  let lastLayoutWidth = 0;
  let lastLayoutHeight = 0;
  let lastLayoutOffsetX = 0;
  let lastLayoutOffsetY = 0;
  let lastLayoutDpr = 0;
  let lastSafeTop = 0;
  let lastSafeRight = 0;
  let lastSafeBottom = 0;
  let lastSafeLeft = 0;

  // State registry and lifecycle flags (zero hard-coded state names in Core)
  const stateRegistry = Object.create(null);
  let cachedStateNamesStr = 'none';
  let activeStateName = null;
  let pendingStateName = null;
  let inFrame = false;
  let paused = false;

  // Loop, listener, error, and debug-only metrics
  let listenersBound = false;
  let loopStarted = false;
  let lastTimestamp = 0;
  let errorCount = 0;
  let lastErrorLogTime = -Infinity;
  let fpsFrameCount = 0;
  let fpsAccumMs = 0;
  let smoothedFps = 0;
  let slowFrameCount = 0;
  let maxFrameMs = 0;
  let activeDprMediaQuery = null;

  // Cached debug panel lines and extra lines (zero allocation when DEBUG is false)
  const debugLines = new Array(6);
  const debugExtraLines = [];
  let debugExtraRaw = '';
  let debugMetricsDirty = true;
  let debugLayoutDirty = true;

  // Parses a CSS pixel value into a finite non-negative number, defaulting to 0.
  function parseCssPx(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  // Counts a runtime error and logs via console.error at most once per second.
  function handleLoopError(phase, err) {
    errorCount += 1;
    debugMetricsDirty = true;
    const now = performance.now();
    if (now - lastErrorLogTime >= ERROR_LOG_INTERVAL_MS) {
      lastErrorLogTime = now;
      console.error('[GameCore] Error in ' + phase + ':', err);
    }
  }

  // Wraps ctx.save and ctx.restore once to unwind any unmatched inner state saves.
  function installCanvasStackGuard() {
    if (!ctx || origSave !== null) return;
    origSave = ctx.save;
    origRestore = ctx.restore;

    // Tracks nested save calls made while a state render callback executes.
    ctx.save = function guardedSave() {
      if (trackingStateSaves) {
        stateSaveDepth += 1;
      }
      return origSave.call(ctx);
    };

    // Prevents a state render callback from restoring past the core save frame.
    ctx.restore = function guardedRestore() {
      if (trackingStateSaves) {
        if (stateSaveDepth <= 0) return;
        stateSaveDepth -= 1;
      }
      return origRestore.call(ctx);
    };
  }

  // Resets all 2D canvas styles and shadow state to clean defaults before each render.
  function resetCanvasStyles(context) {
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.lineWidth = 1;
    context.lineCap = 'butt';
    context.lineJoin = 'miter';
    context.miterLimit = 10;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.shadowBlur = 0;
    context.shadowColor = 'rgba(0, 0, 0, 0)';
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }

  // Rebuilds the cached comma-separated registered state names string on registry change.
  function refreshCachedStateNames() {
    const names = Object.keys(stateRegistry);
    cachedStateNamesStr = names.length > 0 ? names.join(', ') : 'none';
    debugMetricsDirty = true;
  }

  // Marks the layout dirty so updateLayout runs at most once on the next animation frame.
  function markLayoutDirty() {
    layoutDirty = true;
  }

  // Watches for devicePixelRatio changes using a single matchMedia listener that marks layout dirty.
  function watchDprChange(currentDpr) {
    if (typeof window.matchMedia !== 'function') return;

    if (activeDprMediaQuery) {
      if (typeof activeDprMediaQuery.removeEventListener === 'function') {
        activeDprMediaQuery.removeEventListener('change', markLayoutDirty);
      } else if (typeof activeDprMediaQuery.removeListener === 'function') {
        activeDprMediaQuery.removeListener(markLayoutDirty);
      }
    }

    activeDprMediaQuery = window.matchMedia('(resolution: ' + currentDpr + 'dppx)');

    if (typeof activeDprMediaQuery.addEventListener === 'function') {
      activeDprMediaQuery.addEventListener('change', markLayoutDirty);
    } else if (typeof activeDprMediaQuery.addListener === 'function') {
      activeDprMediaQuery.addListener(markLayoutDirty);
    }
  }

  // Reads safe areas from #safeAreaProbe and updates canvas buffer and scale only when changed.
  function updateLayout() {
    if (!canvas) return;

    try {
      const vv = window.visualViewport;
      const nextW = vv ? vv.width : window.innerWidth;
      const nextH = vv ? vv.height : window.innerHeight;
      const nextOffX = vv && Number.isFinite(vv.offsetLeft) ? vv.offsetLeft : 0;
      const nextOffY = vv && Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0;

      if (!Number.isFinite(nextW) || !Number.isFinite(nextH) || nextW <= 0 || nextH <= 0) {
        return;
      }

      const rawDpr = window.devicePixelRatio;
      const nextDpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;

      let nextTop = 0;
      let nextRight = 0;
      let nextBottom = 0;
      let nextLeft = 0;
      if (safeAreaProbeEl) {
        const probeStyle = window.getComputedStyle(safeAreaProbeEl);
        nextTop = parseCssPx(probeStyle.paddingTop);
        nextRight = parseCssPx(probeStyle.paddingRight);
        nextBottom = parseCssPx(probeStyle.paddingBottom);
        nextLeft = parseCssPx(probeStyle.paddingLeft);
      }

      if (
        hasLayoutInitialized &&
        lastLayoutWidth === nextW &&
        lastLayoutHeight === nextH &&
        lastLayoutOffsetX === nextOffX &&
        lastLayoutOffsetY === nextOffY &&
        lastLayoutDpr === nextDpr &&
        lastSafeTop === nextTop &&
        lastSafeRight === nextRight &&
        lastSafeBottom === nextBottom &&
        lastSafeLeft === nextLeft
      ) {
        return;
      }

      const dprChanged = !hasLayoutInitialized || lastLayoutDpr !== nextDpr;
      const nextScale = Math.min(nextW / GAME_WIDTH, nextH / GAME_HEIGHT);
      const nextOffsetX = (nextW - GAME_WIDTH * nextScale) / 2;
      const nextOffsetY = (nextH - GAME_HEIGHT * nextScale) / 2;
      const effDpr = Math.min(nextDpr, Math.sqrt(MAX_CANVAS_PIXELS / (nextW * nextH)));
      const nextPxW = Math.max(1, Math.round(nextW * effDpr));
      const nextPxH = Math.max(1, Math.round(nextH * effDpr));

      canvas.width = nextPxW;
      canvas.height = nextPxH;
      canvas.style.width = nextW + 'px';
      canvas.style.height = nextH + 'px';

      viewportWidth = nextW;
      viewportHeight = nextH;
      vpOffsetX = nextOffX;
      vpOffsetY = nextOffY;
      dpr = effDpr;
      scale = nextScale;
      offsetX = nextOffsetX;
      offsetY = nextOffsetY;
      canvasPixelWidth = nextPxW;
      canvasPixelHeight = nextPxH;

      offsetOut.x = offsetX + vpOffsetX;
      offsetOut.y = offsetY + vpOffsetY;
      safeAreaOut.top = nextTop;
      safeAreaOut.right = nextRight;
      safeAreaOut.bottom = nextBottom;
      safeAreaOut.left = nextLeft;

      hasLayoutInitialized = true;
      lastLayoutWidth = nextW;
      lastLayoutHeight = nextH;
      lastLayoutOffsetX = nextOffX;
      lastLayoutOffsetY = nextOffY;
      lastLayoutDpr = nextDpr;
      lastSafeTop = nextTop;
      lastSafeRight = nextRight;
      lastSafeBottom = nextBottom;
      lastSafeLeft = nextLeft;
      debugLayoutDirty = true;

      if (dprChanged) {
        watchDprChange(nextDpr);
      }
    } catch (err) {
      handleLoopError('updateLayout', err);
    }
  }

  // Sanitizes state handler objects so missing callbacks become null and pausable defaults to false.
  function sanitizeHandlers(handlers) {
    const src = handlers && typeof handlers === 'object' ? handlers : null;
    return {
      enter: src && typeof src.enter === 'function' ? src.enter : null,
      exit: src && typeof src.exit === 'function' ? src.exit : null,
      update: src && typeof src.update === 'function' ? src.update : null,
      render: src && typeof src.render === 'function' ? src.render : null,
      pausable: Boolean(src && src.pausable)
    };
  }

  // Registers or replaces handlers for a non-empty state name and refreshes the cached list.
  function registerState(name, handlers) {
    if (typeof name !== 'string' || name.trim().length === 0) return false;
    stateRegistry[name] = sanitizeHandlers(handlers);
    refreshCachedStateNames();
    return true;
  }

  // Removes a registered state while refusing removal of the active or queued state.
  function unregisterState(name) {
    if (typeof name !== 'string' || !(name in stateRegistry)) return false;
    if (name === activeStateName || name === pendingStateName) return false;
    delete stateRegistry[name];
    refreshCachedStateNames();
    return true;
  }

  // Applies a validated state transition in strict exit -> switch -> paused=false -> enter order.
  function applyStateTransition(nextName) {
    if (typeof nextName !== 'string' || !(nextName in stateRegistry)) return false;

    const prevName = activeStateName;
    const prevState = prevName !== null ? stateRegistry[prevName] : null;

    if (prevState && prevState.exit) {
      try {
        prevState.exit(nextName);
      } catch (err) {
        handleLoopError('exit', err);
      }
    }

    activeStateName = nextName;
    paused = false;
    lastTimestamp = 0;
    debugMetricsDirty = true;

    const nextState = stateRegistry[nextName];
    if (nextState && nextState.enter) {
      try {
        nextState.enter(prevName);
      } catch (err) {
        handleLoopError('enter', err);
      }
    }

    return true;
  }

  // Switches to a registered state immediately or queues the transition if called mid-frame.
  function setState(name) {
    if (typeof name !== 'string' || !(name in stateRegistry)) return false;
    if (inFrame) {
      pendingStateName = name;
      return true;
    }
    return applyStateTransition(name);
  }

  // Returns the currently active state name or null.
  function getState() {
    return activeStateName;
  }

  // Checks whether the currently active state allows pausing.
  function canPauseActiveState() {
    if (activeStateName === null) return false;
    const activeState = stateRegistry[activeStateName];
    return Boolean(activeState && activeState.pausable === true);
  }

  // Returns true when core updates are currently paused.
  function isPaused() {
    return paused;
  }

  // Pauses updates only when the active state declares pausable === true.
  function pause() {
    if (!canPauseActiveState()) return false;
    if (!paused) {
      paused = true;
      debugMetricsDirty = true;
    }
    return true;
  }

  // Resumes updates and resets lastTimestamp so no dt jump occurs.
  function resume() {
    const wasPaused = paused;
    paused = false;
    lastTimestamp = 0;
    if (wasPaused) {
      debugMetricsDirty = true;
    }
    return wasPaused;
  }

  // Returns the boolean DEBUG flag determined from ?debug=1.
  function isDebug() {
    return DEBUG;
  }

  // Stores cached extra debug text split into lines only when the text actually changes.
  function setDebugExtra(text) {
    const next = typeof text === 'string' ? text : '';
    if (next === debugExtraRaw) return;
    debugExtraRaw = next;
    debugExtraLines.length = 0;
    if (next.length > 0) {
      const parts = next.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].length > 0) {
          debugExtraLines.push(parts[i]);
        }
      }
    }
  }

  // Tracks smoothed FPS, slow frames (>50 ms), and max frame time strictly when DEBUG is true.
  function updateDebugMetrics(rawMs) {
    if (rawMs <= 0 || rawMs > RESUME_GAP_MS) return;

    if (rawMs > SLOW_FRAME_MS) {
      slowFrameCount += 1;
      debugMetricsDirty = true;
    }
    if (rawMs > maxFrameMs) {
      maxFrameMs = rawMs;
      debugMetricsDirty = true;
    }

    fpsFrameCount += 1;
    fpsAccumMs += rawMs;

    if (fpsAccumMs >= FPS_UPDATE_INTERVAL_MS) {
      smoothedFps = Math.round((fpsFrameCount * 1000) / fpsAccumMs);
      fpsFrameCount = 0;
      fpsAccumMs = 0;
      debugMetricsDirty = true;
    }
  }

  // Rebuilds cached base debug strings only when their underlying values change.
  function refreshDebugLines() {
    if (debugMetricsDirty) {
      debugLines[0] = 'Version: ' + APP_VERSION + ' | State: ' + (activeStateName || 'NONE') + ' | Paused: ' + paused;
      debugLines[1] = 'FPS: ' + smoothedFps + ' | Errors: ' + errorCount + ' | Slow(>50ms): ' + slowFrameCount + ' | Max: ' + maxFrameMs.toFixed(1) + 'ms';
      debugLines[2] = 'States: ' + cachedStateNamesStr;
      debugMetricsDirty = false;
    }

    if (debugLayoutDirty) {
      debugLines[3] = 'Canvas: ' + canvasPixelWidth + 'x' + canvasPixelHeight + ' px | DPR: ' + dpr.toFixed(2) + ' (dev ' + lastLayoutDpr.toFixed(2) + ')';
      debugLines[4] = 'Viewport: ' + Math.round(viewportWidth) + 'x' + Math.round(viewportHeight) + ' css | Scale: ' + scale.toFixed(4);
      debugLines[5] = 'GameArea: ' + Math.round(GAME_WIDTH * scale) + 'x' + Math.round(GAME_HEIGHT * scale) + ' | Safe: ' + Math.round(safeAreaOut.top) + '/' + Math.round(safeAreaOut.right) + '/' + Math.round(safeAreaOut.bottom) + '/' + Math.round(safeAreaOut.left);
      debugLayoutDirty = false;
    }
  }

  // Draws the temporary 6px logical border and four 12px L-shaped corner markers.
  function drawTempGuides() {
    const halfBorder = BORDER_WIDTH / 2;
    ctx.strokeStyle = TEMP_PALETTE.border;
    ctx.lineWidth = BORDER_WIDTH;
    ctx.strokeRect(
      halfBorder,
      halfBorder,
      GAME_WIDTH - BORDER_WIDTH,
      GAME_HEIGHT - BORDER_WIDTH
    );

    const inset = BORDER_WIDTH + 2;
    const right = GAME_WIDTH - inset;
    const bottom = GAME_HEIGHT - inset;

    ctx.strokeStyle = TEMP_PALETTE.corner;
    ctx.lineWidth = CORNER_LINE_WIDTH;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(inset, inset + CORNER_SIZE);
    ctx.lineTo(inset, inset);
    ctx.lineTo(inset + CORNER_SIZE, inset);

    ctx.moveTo(right - CORNER_SIZE, inset);
    ctx.lineTo(right, inset);
    ctx.lineTo(right, inset + CORNER_SIZE);

    ctx.moveTo(right, bottom - CORNER_SIZE);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right - CORNER_SIZE, bottom);

    ctx.moveTo(inset + CORNER_SIZE, bottom);
    ctx.lineTo(inset, bottom);
    ctx.lineTo(inset, bottom - CORNER_SIZE);
    ctx.stroke();
  }

  // Renders the compact cached debug panel at top-left strictly when DEBUG is true.
  function drawDebugOverlay() {
    refreshDebugLines();

    const totalLines = debugLines.length + debugExtraLines.length;
    const boxX = 10;
    const boxY = 10;
    const boxW = GAME_WIDTH - 20;
    const padX = 6;
    const padY = 5;
    const lineHeight = 11.5;
    const boxH = padY * 2 + totalLines * lineHeight;

    ctx.fillStyle = TEMP_PALETTE.debugBg;
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = TEMP_PALETTE.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.font = '9.5px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = TEMP_PALETTE.debugText;

    let lineIndex = 0;
    for (let i = 0; i < debugLines.length; i++) {
      ctx.fillText(debugLines[i], boxX + padX, boxY + padY + lineIndex * lineHeight);
      lineIndex += 1;
    }
    for (let j = 0; j < debugExtraLines.length; j++) {
      ctx.fillText(debugExtraLines[j], boxX + padX, boxY + padY + lineIndex * lineHeight);
      lineIndex += 1;
    }
  }

  // Renders backdrop, clipped state frame with balanced save/restore, guides, and optional debug panel.
  function renderFrame(activeState) {
    if (!ctx || viewportWidth <= 0 || viewportHeight <= 0) return;

    // 1. Fill full viewport edge-to-edge with muted outer background
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resetCanvasStyles(ctx);
    ctx.fillStyle = TEMP_PALETTE.outerBg;
    ctx.fillRect(0, 0, canvasPixelWidth, canvasPixelHeight);

    // 2. Transform into logical 360x640 coordinates
    const scaleDpr = dpr * scale;
    const tx = (offsetX + vpOffsetX) * dpr;
    const ty = (offsetY + vpOffsetY) * dpr;
    ctx.setTransform(scaleDpr, 0, 0, scaleDpr, tx, ty);

    // 3. Render active state inside balanced save/restore with clip and full style reset
    origSave.call(ctx);
    ctx.beginPath();
    ctx.rect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.clip();
    resetCanvasStyles(ctx);
    stateSaveDepth = 0;
    trackingStateSaves = true;

    try {
      if (activeState && activeState.render) {
        activeState.render(ctx);
      }
    } catch (err) {
      handleLoopError('render', err);
    } finally {
      trackingStateSaves = false;
      while (stateSaveDepth > 0) {
        origRestore.call(ctx);
        stateSaveDepth -= 1;
      }
      origRestore.call(ctx);
    }

    // 4. Restore clean logical transform and draw core guides
    ctx.setTransform(scaleDpr, 0, 0, scaleDpr, tx, ty);
    resetCanvasStyles(ctx);
    drawTempGuides();

    // 5. Draw debug overlay strictly when DEBUG is true
    if (DEBUG) {
      drawDebugOverlay();
    }
  }

  // Runs the single continuous requestAnimationFrame loop with batched layout and error isolation.
  function loop(timestamp) {
    try {
      if (layoutDirty) {
        layoutDirty = false;
        updateLayout();
      }

      let rawMs = 0;
      if (lastTimestamp > 0) {
        rawMs = timestamp - lastTimestamp;
        if (!Number.isFinite(rawMs) || rawMs < 0) {
          rawMs = 0;
        }
      }
      lastTimestamp = timestamp;

      const dt = Math.min(rawMs / 1000, MAX_DT);

      if (DEBUG) {
        updateDebugMetrics(rawMs);
      }

      inFrame = true;
      const activeState = activeStateName !== null ? stateRegistry[activeStateName] : null;

      if (!paused && activeState && activeState.update) {
        try {
          activeState.update(dt);
        } catch (err) {
          handleLoopError('update', err);
        }
      }

      renderFrame(activeState);
      inFrame = false;

      if (pendingStateName !== null) {
        const nextName = pendingStateName;
        pendingStateName = null;
        applyStateTransition(nextName);
      }
    } catch (err) {
      inFrame = false;
      handleLoopError('loop', err);
    } finally {
      window.requestAnimationFrame(loop);
    }
  }

  // Starts the single requestAnimationFrame chain strictly once.
  function startLoop() {
    if (loopStarted) return;
    loopStarted = true;
    window.requestAnimationFrame(loop);
  }

  // Auto-pauses pausable states when hidden and marks layout dirty when returning visible.
  function handleVisibilityChange() {
    lastTimestamp = 0;
    if (document.hidden) {
      pause();
    } else {
      markLayoutDirty();
    }
  }

  // Auto-pauses pausable states on pagehide and resets frame timestamp.
  function handlePageHide() {
    lastTimestamp = 0;
    pause();
  }

  // Blocks long-press context menus on the canvas.
  function handleContextMenu(event) {
    event.preventDefault();
  }

  // Returns the uniform "contain" scale factor from logical units to CSS px.
  function getScale() {
    return scale;
  }

  // Returns the reusable { x, y } offset of the logical 360x640 area in CSS px.
  function getOffset() {
    return offsetOut;
  }

  // Converts CSS viewport coordinates into logical 360x640 coordinates using out or shared object.
  function screenToGame(clientX, clientY, out) {
    const target = out || screenToGameOut;
    if (scale <= 0) {
      target.x = 0;
      target.y = 0;
      return target;
    }
    target.x = (clientX - offsetX - vpOffsetX) / scale;
    target.y = (clientY - offsetY - vpOffsetY) / scale;
    return target;
  }

  // Returns the reusable { top, right, bottom, left } safe-area insets in CSS px.
  function getSafeArea() {
    return safeAreaOut;
  }

  // Returns the frozen logical dimensions { width: 360, height: 640 }.
  function getLogicalSize() {
    return LOGICAL_SIZE;
  }

  // Installs canvas guards, binds each Core listener strictly once, updates layout, and starts the loop.
  function initCore() {
    if (listenersBound || !canvas || !ctx) return;
    listenersBound = true;

    installCanvasStackGuard();

    window.addEventListener('resize', markLayoutDirty);
    window.addEventListener('orientationchange', markLayoutDirty);
    window.addEventListener('pagehide', handlePageHide);

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', markLayoutDirty);
      window.visualViewport.addEventListener('scroll', markLayoutDirty);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    canvas.addEventListener('contextmenu', handleContextMenu);

    updateLayout();
    startLoop();
  }

  // Expose frozen public API for all Modules
  window.GameCore = Object.freeze({
    getScale: getScale,
    getOffset: getOffset,
    screenToGame: screenToGame,
    getSafeArea: getSafeArea,
    getLogicalSize: getLogicalSize,
    getState: getState,
    setState: setState,
    registerState: registerState,
    unregisterState: unregisterState,
    isPaused: isPaused,
    pause: pause,
    resume: resume,
    isDebug: isDebug,
    setDebugExtra: setDebugExtra
  });

  initCore();
})();
