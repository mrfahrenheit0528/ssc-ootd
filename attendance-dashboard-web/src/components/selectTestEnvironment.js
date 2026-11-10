// DOM-only interaction tests; layout and physical-device behavior need a browser.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true })
const { window } = dom
for (const name of ['window','document','navigator','HTMLElement','Element','Node','DocumentFragment','MutationObserver','Event','CustomEvent','KeyboardEvent','MouseEvent','HTMLInputElement','HTMLSelectElement','HTMLFormElement','HTMLButtonElement','SVGElement','NodeFilter','Document','DOMRect']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] })
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
class PointerEvent extends window.MouseEvent {
  constructor(type, props = {}) {
    super(type, props)
    Object.defineProperties(this, { pointerId: {value:props.pointerId ?? 1, configurable:true}, pointerType: {value:props.pointerType ?? 'mouse', configurable:true}, isPrimary: {value:props.isPrimary ?? true, configurable:true} })
  }
}
window.PointerEvent = globalThis.PointerEvent = PointerEvent
window.HTMLElement.prototype.hasPointerCapture = () => false
window.HTMLElement.prototype.setPointerCapture = () => {}
window.HTMLElement.prototype.releasePointerCapture = () => {}
window.HTMLElement.prototype.scrollIntoView = () => {}
class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = globalThis.ResizeObserver = ResizeObserver
export { dom }
