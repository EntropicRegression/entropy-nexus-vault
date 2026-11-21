// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { manualClock } from '../test-support/manual-clock';
import { applyFloorFrame, createFloorCamera, easeInOutCubic, floorFrame, floorTiming, restingFrame } from './floor-camera';
import type { FloorElements } from './floor-camera';

describe('樓層切換曲線(DESIGN.md §8)', () => {
  it('緩動是 ease-in-out cubic,兩端固定、中點 0.5', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it.each([
    [0, 1, 0, 0, false],
    [0.25, 0.9375, 2.4 * Math.SQRT1_2, 14 * Math.SQRT1_2, false],
    [0.45, 1 - easeInOutCubic(0.45), 2.4 * Math.sin(Math.PI * 0.45), 14 * Math.sin(Math.PI * 0.45), true],
    [0.5, 0.5, 2.4, 14, true],
    [0.75, 0.0625, 2.4 * Math.SQRT1_2, 14 * Math.SQRT1_2, true],
    [1, 0, 0, 0, true],
  ])('上樓 t=%s:位移、傾斜、Y 軸模糊與頂列交換', (t, offset, tilt, blur, swapped) => {
    const frame = floorFrame(t, 'sky');
    expect(frame.offset).toBeCloseTo(offset);
    expect(frame.tiltDeg).toBeCloseTo(tilt);
    expect(frame.blurY).toBeCloseTo(blur);
    expect(frame.swapped).toBe(swapped);
    expect(frame.tiltDeg).toBeLessThanOrEqual(floorTiming.maxTilt);
  });

  it('下樓傾斜為負、位移方向相反;兩方向模糊相同', () => {
    for (const t of [0, 0.25, 0.45, 0.5, 0.75, 1]) {
      const up = floorFrame(t, 'sky');
      const down = floorFrame(t, 'library');
      expect(down.offset).toBeCloseTo(1 - up.offset);
      expect(down.tiltDeg).toBeCloseTo(-up.tiltDeg);
      expect(down.blurY).toBeCloseTo(up.blurY);
    }
  });

  it('兩層背景以不同速度視差,終點歸零;t 超出範圍會被夾住', () => {
    const middle = floorFrame(0.5, 'sky');
    expect(middle.libraryShiftPx).not.toBe(0);
    expect(middle.starShiftPx).not.toBe(0);
    expect(Math.abs(middle.libraryShiftPx)).not.toBeCloseTo(Math.abs(middle.starShiftPx));
    expect(floorFrame(-1, 'sky')).toEqual(floorFrame(0, 'sky'));
    expect(floorFrame(3, 'library')).toEqual(floorFrame(1, 'library'));
    expect(restingFrame('library')).toEqual({ offset: 1, tiltDeg: 0, blurY: 0, libraryShiftPx: 0, starShiftPx: 0, swapped: true });
    expect(restingFrame('sky')).toMatchObject({ offset: 0, blurY: 0, tiltDeg: 0 });
  });
});

function elements(): FloorElements {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'feGaussianBlur') as SVGFEGaussianBlurElement;
  svg.append(filter);
  return { world: document.createElement('div'), blur: filter, libraryBackground: document.createElement('div'), stars: document.createElement('canvas') };
}

describe('樓層攝影機狀態機', () => {
  function setup() {
    const manual = manualClock();
    const dom = elements();
    const onSwap = vi.fn();
    const onFinish = vi.fn();
    const camera = createFloorCamera({ clock: manual.clock, elements: () => dom, filterId: 'blur', onSwap, onFinish });
    camera.rest('library');
    return { manual, dom, onSwap, onFinish, camera };
  }

  it('逐幀寫入純函式的值,45% 交換頂列一次,結束時移除濾鏡與傾斜', () => {
    const { manual, dom, onSwap, onFinish, camera } = setup();
    expect(dom.world!.style.transform).toBe('translateY(-50%)');
    expect(dom.world!.style.filter).toBe('');
    camera.start('sky', false);
    manual.tick(0);
    manual.tick(0.25 * floorTiming.duration);
    expect(dom.world!.style.transform).toMatch(/^translateY\(-46\.875%\) rotateX\(1\.697deg\)$/);
    expect(dom.world!.style.filter).toMatch(/^url\("?#blur"?\)$/);
    expect(dom.blur!.getAttribute('stdDeviation')).toBe('0 ' + (14 * Math.SQRT1_2).toFixed(2));
    expect(onSwap).not.toHaveBeenCalled();
    manual.tick(0.45 * floorTiming.duration);
    expect(onSwap).toHaveBeenCalledExactlyOnceWith('sky');
    manual.tick(0.5 * floorTiming.duration);
    expect(dom.blur!.getAttribute('stdDeviation')).toBe('0 14.00');
    manual.tick(0.75 * floorTiming.duration);
    expect(onFinish).not.toHaveBeenCalled();
    manual.tick(floorTiming.duration);
    expect(onSwap).toHaveBeenCalledOnce();
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('sky', false);
    expect(dom.world!.style.transform).toBe('translateY(0%)');
    expect(dom.world!.style.filter).toBe('');
    expect(dom.libraryBackground!.style.transform).toBe('');
    expect(dom.stars!.style.transform).toBe('');
    expect(manual.count()).toBe(0);
    expect(camera.running).toBe(false);
  });

  it('動畫中再按:直接跳到新目標的終態,沒有半途狀態,也不留排程', () => {
    const { manual, dom, onSwap, onFinish, camera } = setup();
    camera.start('sky', false);
    manual.tick(0.3 * floorTiming.duration);
    camera.start('library', false);
    expect(onSwap).toHaveBeenCalledExactlyOnceWith('library');
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('library', false);
    expect(dom.world!.style.transform).toBe('translateY(-50%)');
    expect(dom.world!.style.filter).toBe('');
    expect(manual.count()).toBe(0);
    // Pressing the same floor again mid-pan also lands at once.
    manual.tick(2000);
    camera.start('sky', false);
    manual.tick(2000 + 0.6 * floorTiming.duration);
    expect(dom.world!.style.filter).not.toBe('');
    camera.start('sky', false);
    expect(onFinish).toHaveBeenLastCalledWith('sky', false);
    expect(dom.world!.style.transform).toBe('translateY(0%)');
    expect(manual.count()).toBe(0);
  });

  it('低動態:不平移、不模糊、不排程,立即到終態', () => {
    const { manual, dom, onSwap, onFinish, camera } = setup();
    camera.start('sky', true);
    expect(manual.count()).toBe(0);
    expect(onSwap).toHaveBeenCalledExactlyOnceWith('sky');
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('sky', true);
    expect(dom.world!.style.transform).toBe('translateY(0%)');
    expect(dom.world!.style.filter).toBe('');
    expect(dom.blur!.getAttribute('stdDeviation')).toBe('0 0.00');
  });

  it('已停在目標樓層時再按:不重播動畫', () => {
    const { manual, onFinish, camera } = setup();
    camera.start('library', false);
    expect(manual.count()).toBe(0);
    expect(onFinish).toHaveBeenCalledExactlyOnceWith('library', false);
  });

  it('applyFloorFrame 在沒有傾斜時不寫 rotateX', () => {
    const dom = elements();
    applyFloorFrame(dom, floorFrame(1, 'library'), 'x');
    expect(dom.world!.style.transform).toBe('translateY(-50%)');
  });
});
