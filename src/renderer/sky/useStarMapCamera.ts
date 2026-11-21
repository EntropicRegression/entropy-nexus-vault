import { useEffect, useRef } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react';
import { initialCamera, rotateCamera, zoomCamera } from '../../shared/projection';
import type { Camera } from '../../shared/projection';

interface Drag { pointer: number; x: number; y: number; startX: number; startY: number; moved: boolean }
const keyboardStep = (Math.PI / 18) / 0.007;
const rotationKeys = new Map([
  ['ArrowLeft', [-keyboardStep, 0]], ['ArrowRight', [keyboardStep, 0]],
  ['ArrowUp', [0, -keyboardStep]], ['ArrowDown', [0, keyboardStep]],
]);

export function useStarMapCamera(
  stage: RefObject<HTMLDivElement | null>, camera: RefObject<Camera>, demandFrame: () => void, active: boolean,
  adjusted: RefObject<boolean> = { current: false },
) {
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    const element = stage.current;
    if (!element || !active) return;
    function onWheel(event: WheelEvent) {
      if (event.target instanceof Element && event.target.closest('[data-map-controls]')) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1);
      camera.current = zoomCamera(camera.current, pixels);
      adjusted.current = true;
      demandFrame();
    }
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
      if (drag.current && element.hasPointerCapture?.(drag.current.pointer)) element.releasePointerCapture(drag.current.pointer);
      drag.current = null;
      suppressClick.current = false;
    };
  }, [stage, camera, demandFrame, active]);

  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    suppressClick.current = drag.current.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return {
    canClick: (event: MouseEvent) => event.detail === 0 || !suppressClick.current,
    handlers: {
      onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
        if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
        const rotation = rotationKeys.get(event.key);
        if (rotation) camera.current = rotateCamera(camera.current, rotation[0], rotation[1]);
        else if (event.key === '+' || event.key === '=') camera.current = zoomCamera(camera.current, -125);
        else if (event.key === '-' || event.key === '−') camera.current = zoomCamera(camera.current, 125);
        else if (event.key === '0') camera.current = { ...initialCamera };
        else return;
        // "0" returns to the default view, which re-enables auto-fit; any other key is a manual adjustment.
        adjusted.current = event.key !== '0';
        event.preventDefault();
        demandFrame();
      },
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || drag.current ||
          (event.target instanceof Element && event.target.closest('[data-map-controls]'))) return;
        const { clientX: x, clientY: y, pointerId: pointer } = event;
        suppressClick.current = false;
        drag.current = { pointer, x, y, startX: x, startY: y, moved: false };
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        const { clientX: x, clientY: y } = event;
        if (!start.moved) {
          if (Math.hypot(x - start.startX, y - start.startY) <= 3) return;
          start.moved = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }
        camera.current = rotateCamera(camera.current, x - start.x, y - start.y);
        adjusted.current = true;
        start.x = x;
        start.y = y;
        demandFrame();
      },
      onPointerUp: finish,
      onPointerCancel: finish,
      onLostPointerCapture: finish,
      onPointerLeave(event: PointerEvent<HTMLDivElement>) {
        if (!drag.current?.moved) finish(event);
      },
    },
  };
}
