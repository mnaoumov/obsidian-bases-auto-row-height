/**
 * Measures how much of an element's height is visible through its scrolling ancestors and the window: the
 * page height the table view uses for PageUp and PageDown.
 *
 * It follows the table view's own viewport helper: every scrolling ancestor clips the top and the bottom,
 * and the direct parent clips the bottom starting again from the window's.
 *
 * @param el - The element.
 * @returns The visible height, in the element's own coordinates.
 */
export function getVisibleHeight(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const roundedHeight = Math.round(rect.height);
  const scale = roundedHeight > 0 ? el.clientHeight / roundedHeight : 1;
  const { win } = el;
  let top = 0;
  let bottom = win.innerHeight;
  let node = el.parentElement;
  while (node && node !== el.ownerDocument.body) {
    const style = win.getComputedStyle(node);
    const isScrolling = (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) && style.overflow !== 'visible';
    if (isScrolling) {
      const nodeRect = node.getBoundingClientRect();
      top = Math.max(top, nodeRect.top);
      bottom = Math.min(node === el.parentElement ? win.innerHeight : bottom, nodeRect.bottom);
    }
    node = style.position === 'absolute' || style.position === 'fixed' ? node.offsetParent as HTMLElement | null : node.parentElement;
  }
  return scale * (Math.max(top, bottom) - top);
}
