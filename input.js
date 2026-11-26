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

  // Starts tracking a primary pointer press in logical coordinates when enabled and unpaused.
  function handlePointerDown(event) {
    if (!enabled || !event.isPrimary || activePointerId !== null || GameCore.isPaused()) return;
    event.preventDefault();

    activePointerId = event.pointerId;
    if (canvas && typeof canvas.setPointerCapture === 'function') {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (err) {
        // Ignore capture errors on synthetic pointers.
      }
    }

    GameCore.screenToGame(event.clientX, event.clientY, startPos);
  }

  // Prevents browser default gestures while tracking the active primary pointer without emitting swipes.
  function handlePointerMove(event) {
    if (!enabled || !event.isPrimary || event.pointerId !== activePointerId) return;
    event.preventDefault();
  }

  // Classifies the completed gesture on pointer release as a tap, directional swipe, or no-op.
  function handlePointerUp(event) {
    if (!enabled || !event.isPrimary || event.pointerId !== activePointerId) return;
    event.preventDefault();

    releaseCaptureSafe(event.pointerId);
    GameCore.screenToGame(event.clientX, event.clientY, endPos);

    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    activePointerId = null;

    if (dx * dx + dy * dy < TAP_MAX_SQ) {
      if (tapHandler) {
        tapHandler();
      }
      return;
    }

    const absX = dx < 0 ? -dx : dx;
    const absY = dy < 0 ? -dy : dy;

    if (absX >= absY) {
      if (absX >= SWIPE_MIN && swipeHandler) {
        swipeHandler(dx > 0 ? 1 : -1, 0);
      }
    } else if (absY >= SWIPE_MIN && swipeHandler) {
      swipeHandler(0, dy > 0 ? 1 : -1);
    }
  }

  // Cancels active pointer tracking safely without emitting a tap or swipe.
  function handlePointerCancel(event) {
    if (event.pointerId !== activePointerId) return;
    releaseCaptureSafe(event.pointerId);
    activePointerId = null;
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
