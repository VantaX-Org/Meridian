/**
 * jsdom has no layout, so the virtual list would measure a 0 by 0 scroll area and draw no rows. This gives every
 * element the size a browser would report and returns a function that puts the originals back.
 */
export function stubLayout(width = 900, height = 480): () => void {
  const restore: Array<() => void> = [];
  const defs: Array<[string, number]> = [["offsetHeight", height], ["offsetWidth", width], ["clientHeight", height], ["clientWidth", width]];
  for (const [prop, value] of defs) {
    const old = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    restore.push(() => (old ? Object.defineProperty(HTMLElement.prototype, prop, old) : delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]));
  }
  const rect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
  restore.push(() => (HTMLElement.prototype.getBoundingClientRect = rect));
  const scrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function scrollToStub(this: Element, x?: ScrollToOptions | number, y?: number) {
    const top = typeof x === "object" ? (x.top ?? 0) : (y ?? 0);
    (this as HTMLElement).scrollTop = top;
  } as typeof Element.prototype.scrollTo;
  restore.push(() => (Element.prototype.scrollTo = scrollTo));
  return () => restore.reverse().forEach((fn) => fn());
}
