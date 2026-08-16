// Reactive face card — sits above the Prompt Library / Code Snippets lists,
// and fronts the lock screen (auth.js).
// initFaceCard(hostId, opts) can be called once per host for independent
// instances. The card behaves like a physical object anchored at its center:
// it tilts away from the cursor and its expression escalates as the cursor
// closes in, based on distance from the card's center (not just hover).
//
// States, by distance from card center:
//   > FAR_PX             idle     ( • ◡ • )  flat, no tilt
//   NEAR_PX .. FAR_PX     warning  ( • ﹏ • )  partial tilt, scaled by proximity
//   < NEAR_PX             danger   ( > ﹏ < )  max tilt
//
// `ok` ( ^ ◡ ^ ) is unreachable by proximity — only a caller pins it, which is
// how the lock screen reacts to a sign-in that succeeded.
//
// Returns a controller so auth outcomes can outrank the cursor:
//   setState(name)  pin an expression until release()
//   release()       hand control back to proximity

const FAR_PX = 260; // beyond this, fully idle and flat
const NEAR_PX = 100; // within this, maxed out
const MAX_TILT_DEG = 22;
const MAX_FLEE_PX = 34; // how far the card scoots away at max proximity

const FACES = {
  idle: '• ◡ •',
  warning: '• ﹏ •',
  danger: '> ﹏ <',
  ok: '^ ◡ ^',
};

const IDLE_TRANSFORM = 'translate3d(0px, 0px, 0) rotateX(0deg) rotateY(0deg)';

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * @param {string} hostId element to append the card to
 * @param {{compact?: boolean, lines?: boolean}} [opts]
 *   compact — lock-screen sizing: narrow, no skeleton lines
 *   lines   — draw the two skeleton bars under the face (default true)
 * @returns {{setState: (s: string) => void, release: () => void} | undefined}
 */
export function initFaceCard(hostId, opts = {}) {
  const host = document.getElementById(hostId);
  if (!host) return;

  const { compact = false, lines = !compact } = opts;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const wrap = document.createElement('div');
  wrap.className = 'face-card-wrap flex justify-center';
  const card = document.createElement('div');
  card.className = compact
    ? 'face-card flex w-28 flex-col items-center rounded-card border border-edge bg-panel px-4 py-3 shadow-card'
    : 'face-card flex w-64 flex-col items-center gap-3 rounded-card border border-edge bg-panel px-6 py-5 shadow-card';
  card.dataset.state = 'idle';

  const face = document.createElement('div');
  face.className = 'face-card-emoji select-none text-2xl font-semibold';
  face.textContent = FACES.idle;
  card.appendChild(face);

  if (lines) {
    const bars = document.createElement('div');
    bars.className = 'flex w-full flex-col items-center gap-2';
    const line1 = document.createElement('div');
    line1.className = 'h-2 w-3/4 rounded-full bg-edge';
    const line2 = document.createElement('div');
    line2.className = 'h-2 w-1/2 rounded-full bg-edge';
    bars.append(line1, line2);
    card.appendChild(bars);
  }

  wrap.appendChild(card);
  host.appendChild(wrap);

  let currentState = 'idle';
  let pinned = false; // a caller has taken the wheel; ignore the cursor
  let rafId = null;
  let lastEvent = null;

  function applyState(state) {
    if (state === currentState) return;
    currentState = state;
    face.textContent = FACES[state];
    card.dataset.state = state;
  }

  // Expression changes are content, not motion, so they stay wired under
  // prefers-reduced-motion — only the tilt below is suppressed.
  const controller = {
    setState(state) {
      if (!FACES[state]) return;
      pinned = true;
      card.style.transform = IDLE_TRANSFORM;
      applyState(state);
    },
    release() {
      pinned = false;
      lastEvent = null;
      applyState('idle');
      card.style.transform = IDLE_TRANSFORM;
    },
  };

  if (reduceMotion) return controller; // flat + pinned faces only

  function update() {
    rafId = null;
    if (!lastEvent || pinned) return;
    // The card can sit in a hidden pane — an inactive tab, or the LogBook
    // workspace while an entry is open. A hidden element measures 0×0 at the
    // origin, which reads as "the cursor is right on top of it", so sit out
    // and stay idle until it's actually on screen.
    if (wrap.offsetParent === null) {
      reset();
      return;
    }
    // Measure from `wrap`, not `card` — the card itself carries the
    // transform, so reading its own rect would feed the flee/tilt offset
    // back into the next frame's center and drift.
    const rect = wrap.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = lastEvent.clientX - cx;
    const dy = lastEvent.clientY - cy;
    const dist = Math.hypot(dx, dy);

    if (dist >= FAR_PX) {
      applyState('idle');
      card.style.transform = IDLE_TRANSFORM;
      return;
    }

    applyState(dist <= NEAR_PX ? 'danger' : 'warning');

    // 0 at FAR_PX, 1 at NEAR_PX — how "pushed" the card is.
    const t = clamp((FAR_PX - dist) / (FAR_PX - NEAR_PX), 0, 1);
    const nx = clamp(dx / FAR_PX, -1, 1);
    const ny = clamp(dy / FAR_PX, -1, 1);
    // Card flees and tilts away from the cursor, on the axis it's being
    // pushed from — like it's spooked and scooting sideways.
    const fleeX = -nx * MAX_FLEE_PX * t;
    const fleeY = -ny * MAX_FLEE_PX * t;
    const rotY = -nx * MAX_TILT_DEG * t;
    const rotX = ny * MAX_TILT_DEG * t;
    card.style.transform =
      `translate3d(${fleeX.toFixed(1)}px, ${fleeY.toFixed(1)}px, 0) ` +
      `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  }

  function onMove(e) {
    lastEvent = e;
    if (rafId == null) rafId = requestAnimationFrame(update);
  }

  function reset() {
    lastEvent = null;
    if (pinned) return; // a pinned expression outlives a cursor exit
    applyState('idle');
    card.style.transform = IDLE_TRANSFORM;
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseleave', reset);
  window.addEventListener('blur', reset);

  return controller;
}
