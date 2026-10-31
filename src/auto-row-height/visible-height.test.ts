import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { getVisibleHeight } from './visible-height.ts';

interface Box {
  readonly clientHeight?: number;
  readonly clientWidth?: number;
  readonly height: number;
  readonly scrollHeight?: number;
  readonly scrollWidth?: number;
  readonly top: number;
  readonly width?: number;
}

function setBox(el: HTMLElement, box: Box): void {
  const width = box.width ?? 100;
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ height: box.height, width, x: 0, y: box.top }));
  Object.defineProperties(el, {
    clientHeight: { configurable: true, value: box.clientHeight ?? box.height },
    clientWidth: { configurable: true, value: box.clientWidth ?? width },
    scrollHeight: { configurable: true, value: box.scrollHeight ?? box.height },
    scrollWidth: { configurable: true, value: box.scrollWidth ?? width }
  });
}

describe('getVisibleHeight', () => {
  afterEach(() => {
    document.body.empty();
    vi.restoreAllMocks();
  });

  it('clips the element by its scrolling ancestors and the window', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const scrollerEl = document.body.createDiv();
    scrollerEl.setCssStyles({ overflow: 'auto' });
    const parentEl = scrollerEl.createDiv();
    const el = parentEl.createDiv();
    setBox(scrollerEl, { height: 500, scrollHeight: 3000, top: 100 });
    setBox(parentEl, { height: 3000, top: -200 });
    setBox(el, { height: 3000, top: -200 });

    // The scroller shows 100..600 of the window; the element starts at -200, so 300..800 of it is visible.
    expect(getVisibleHeight(el)).toBe(500);
  });

  it('clips by the direct parent too, starting again from the window bottom', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700);
    const parentEl = document.body.createDiv();
    parentEl.setCssStyles({ overflow: 'auto' });
    const el = parentEl.createDiv();
    setBox(parentEl, { height: 300, scrollWidth: 400, top: 50 });
    setBox(el, { height: 2000, top: 50 });

    expect(getVisibleHeight(el)).toBe(300);
  });

  it('follows the offset parent past a positioned ancestor and scales by the element\'s zoom', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    const outerEl = document.body.createDiv();
    const absoluteEl = outerEl.createDiv();
    absoluteEl.setCssStyles({ position: 'absolute' });
    const el = absoluteEl.createDiv();
    Object.defineProperty(absoluteEl, 'offsetParent', { configurable: true, value: null });
    setBox(absoluteEl, { height: 100, top: 0 });
    setBox(el, { clientHeight: 1000, height: 500, top: 0 });

    // The element is drawn at half size, so the 1000 visible pixels are 2000 of its own.
    expect(getVisibleHeight(el)).toBe(2000);
  });

  it('measures an element with no height at scale 1, by the window alone', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(100);
    const el = document.body.createDiv();
    setBox(el, { height: 0, top: 500 });

    expect(getVisibleHeight(el)).toBe(100);
  });
});
