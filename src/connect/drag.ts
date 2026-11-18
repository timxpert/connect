/* Drag down to close, for bottom sheets and the photo viewer.
   - Dragging down follows the finger.
   - Pulling up past the end resists (rubber band), so it can't fly off.
   - Let go far enough (or flick fast) and it slides away and closes.
   - Otherwise it snaps back: animate y to 0 over 0.3s, ease-in-out. */
import { useEffect, useRef } from 'react';

const CLOSE_AT = 110; // px
const FLICK = 0.6; // px per ms

/** px dragged past the end -> how far it actually moves (less and less) */
const rubber = (px: number) => (px * 0.5) / (1 + px / 140);

export function useDragToClose<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let startY = 0;
    let startT = 0;
    let y = 0;
    let dragging = false;
    let id = -1;

    const set = (v: number) => {
      el.style.translate = `0 ${v}px`;
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // let inner scroll areas scroll unless they're at the top
      const scroller = (e.target as HTMLElement).closest('[data-scroll]') as HTMLElement | null;
      if (scroller && scroller.scrollTop > 0) return;
      id = e.pointerId;
      startY = e.clientY;
      startT = performance.now();
      y = 0;
      dragging = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 6) return; // still a tap
        dragging = true;
        el.setPointerCapture(id);
        el.getAnimations().forEach((a) => a.cancel());
      }
      // pull: px dragged past the end (upwards) only moves a little
      y = dy >= 0 ? dy : -rubber(-dy);
      set(y);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (!dragging) return;
      dragging = false;
      const speed = y / Math.max(1, performance.now() - startT);
      const from = y;
      if (y > CLOSE_AT || speed > FLICK) {
        const done = () => closeRef.current();
        if (still) return done();
        el.animate([{ translate: `0 ${from}px` }, { translate: '0 100%' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.then(done, done);
        return;
      }
      // snap back: offset = 0
      set(0);
      if (!still) el.animate([{ translate: `0 ${from}px` }, { translate: '0 0' }], { duration: 300, easing: 'ease-in-out' });
    };
    // a drag shouldn't also count as a tap on whatever is under the finger
    const click = (e: MouseEvent) => {
      if (Math.abs(y) > 6) {
        e.stopPropagation();
        e.preventDefault();
        y = 0;
      }
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('click', click, true);
      el.style.translate = '';
    };
  }, [enabled]);

  return ref;
}
