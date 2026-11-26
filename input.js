/* ============================================================================
   MODULE 2: PLAYER & CONTROLS — POINTER INPUT (input.js)
   ============================================================================ */
(function (GameCore) {
  'use strict';

  // ============================================================================
  // Public API (window.Input — zero allocations per event):
  // - setHandlers(handlers) -> registers { swipe(dirX, dirY), tap() } callbacks or clears them
  // - enable() -> enables input and binds pointer listeners on #gameCanvas once
  // - disable() -> disables input, removes pointer listeners, and resets active pointer state
  // ============================================================================

  if (!GameCore) return;

  // Gesture threshold constants in logical 360x640 units
  const TAP_MAX = 10;
  const TAP_MAX_SQ = TAP_MAX * TAP_MAX;
  const SWIPE_MIN = 30;

  // DOM reference and preallocated coordinate objects (zero per-event allocation)
  const canvas = document.getElementById('gameCanvas');
  const startPos = { x: 0, y: 0 };
  const endPos = { x: 0, y: 0 };

  // Runtime input state and handler slots
  let enabled = false;
  let listenersBound = false;
  let activePointerId = null;
  let gestureConsumed = false;
  let swipeHandler = null;
  let tapHandler = null;

  // Safely releases pointer capture on the canvas if currently held for pointerId.
  function releaseCaptureSafe(pointerId) {
    if (!canvas || typeof canvas.releasePointerCapture !== 'function') return;
    try {
      if (typeof canvas.hasPointerCapture !== 'function' || canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
      }
    } catch (err) {
      // Ignore capture release errors on synthetic or cancelled pointers.
    }
  }

  // Starts tracking a primary pointer press in logical coordinates, recovering from any stale active pointer.
  function handlePointerDown(event) {
    if (!enabled || !event.isPrimary || GameCore.isPaused()) return;
    event.preventDefault();

    if (activePointerId !== null) {
      releaseCaptureSafe(activePointerId);
      activePointerId = null;
      gestureConsumed = false;
    }

    activePointerId = event.pointerId;
    gestureConsumed = false;
    GameCore.screenToGame(event.clientX, event.clientY, startPos);

    if (canvas && typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(activePointerId);
      } catch (err) {
        // Ignore capture errors on synthetic pointers.
      }
    }
  }

  // Detects and emits a single directional swipe on pointermove once dominant displacement reaches SWIPE_MIN.
  function handlePointerMove(event) {
    if (!enabled || activePointerId === null || event.pointerId !== activePointerId) return;
    event.preventDefault();
    if (gestureConsumed) return;

    GameCore.screenToGame(event.clientX, event.clientY, endPos);

    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const dominant = absX >= absY ? absX : absY;

    if (dominant >= SWIPE_MIN) {
      gestureConsumed = true;
      if (swipeHandler) {
        if (absX >= absY) {
          swipeHandler(dx > 0 ? 1 : -1, 0);
        } else {
          swipeHandler(0, dy > 0 ? 1 : -1);
        }
      }
    }
  }

  // Releases the tracked pointer and emits a tap when unconsumed movement stays below TAP_MAX.
  function handlePointerUp(event) {
    if (!enabled || activePointerId === null || event.pointerId !== activePointerId) return;
    event.preventDefault();

    releaseCaptureSafe(activePointerId);
    activePointerId = null;

    if (gestureConsumed) {
      gestureConsumed = false;
      return;
    }

    GameCore.screenToGame(event.clientX, event.clientY, endPos);
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;

    if (dx * dx + dy * dy < TAP_MAX_SQ && tapHandler) {
      tapHandler();
    }
  }

  // Cancels active pointer tracking safely without emitting a tap or swipe.
  function handlePointerCancel(event) {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    releaseCaptureSafe(activePointerId);
    activePointerId = null;
    gestureConsumed = false;
  }

  // Stores or clears swipe and tap callback functions without retaining the passed object.
  function setHandlers(handlers) {
    if (handlers && typeof handlers === 'object') {
      swipeHandler = typeof handlers.swipe === 'function' ? handlers.swipe : null;
      tapHandler = typeof handlers.tap === 'function' ? handlers.tap : null;
    } else {
      swipeHandler = null;
      tapHandler = null;
    }
  }

  // Enables pointer input and attaches the four pointer listeners to #gameCanvas once.
  function enable() {
    enabled = true;
    if (!listenersBound && canvas) {
      listenersBound = true;
      canvas.addEventListener('pointerdown', handlePointerDown);
      canvas.addEventListener('pointermove', handlePointerMove);
      canvas.addEventListener('pointerup', handlePointerUp);
      canvas.addEventListener('pointercancel', handlePointerCancel);
    }
  }

  // Disables pointer input, detaches the four pointer listeners, and resets active tracking.
  function disable() {
    enabled = false;
    if (activePointerId !== null) {
      releaseCaptureSafe(activePointerId);
      activePointerId = null;
    }
    gestureConsumed = false;
    if (listenersBound && canvas) {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      listenersBound = false;
    }
  }

  // Expose frozen public API (strictly 3 methods)
  window.Input = Object.freeze({
    setHandlers: setHandlers,
    enable: enable,
    disable: disable
  });
})(window.GameCore);
