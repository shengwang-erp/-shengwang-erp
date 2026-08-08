class TestStyle {
  setProperty(name, value) { this[name] = String(value) }
  removeProperty(name) { delete this[name] }
}

export class TestEvent {
  constructor(type, options = {}) {
    this.type = type
    this.bubbles = options.bubbles !== false
    this.cancelable = options.cancelable !== false
    this.defaultPrevented = false
    this.target = null
    this.currentTarget = null
  }

  preventDefault() { if (this.cancelable) this.defaultPrevented = true }
  stopPropagation() { this.cancelBubble = true }
}

class TestNode {
  constructor(nodeType, nodeName, ownerDocument) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
    this.parentNode = null
    this.childNodes = []
    this._listeners = new Map()
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child, before) {
    if (before === null) return this.appendChild(child)
    const index = this.childNodes.indexOf(before)
    if (index < 0) throw new Error('reference node is not a child')
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.splice(index, 0, child)
    return child
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child)
    if (index < 0) throw new Error('node is not a child')
    this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  addEventListener(type, listener) {
    const listeners = this._listeners.get(type) ?? new Set()
    listeners.add(listener)
    this._listeners.set(type, listeners)
  }

  removeEventListener(type, listener) { this._listeners.get(type)?.delete(listener) }

  dispatchEvent(event) {
    if (!event.target) event.target = this
    event.currentTarget = this
    for (const listener of this._listeners.get(event.type) ?? []) listener.call(this, event)
    if (event.bubbles && !event.cancelBubble && this.parentNode) this.parentNode.dispatchEvent(event)
    return !event.defaultPrevented
  }

  contains(candidate) {
    if (candidate === this) return true
    return this.childNodes.some((child) => child.contains(candidate))
  }

  get firstChild() { return this.childNodes[0] ?? null }
  get lastChild() { return this.childNodes.at(-1) ?? null }
  get nextSibling() {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }

  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this.nodeValue
    return this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value) {
    if (this.nodeType === 3 || this.nodeType === 8) {
      this.nodeValue = String(value)
      return
    }
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = []
    if (value !== '' && value !== null && value !== undefined) {
      this.appendChild(this.ownerDocument.createTextNode(String(value)))
    }
  }
}

class TestElement extends TestNode {
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(1, tagName.toUpperCase(), ownerDocument)
    this.tagName = this.nodeName
    this.namespaceURI = namespaceURI
    this.attributes = new Map()
    this.style = new TestStyle()
    this.value = ''
    this.checked = false
    this.disabled = false
    this.srcObject = null
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'disabled') this.disabled = true
  }
  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'disabled') this.disabled = false
  }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null }
  click() { this.dispatchEvent(new TestEvent('click')) }

  get className() { return this.getAttribute('class') ?? '' }
  set className(value) { this.setAttribute('class', value) }
  get innerHTML() { return this.textContent }
  set innerHTML(value) { this.textContent = value }
}

class TestText extends TestNode {
  constructor(value, ownerDocument) {
    super(3, '#text', ownerDocument)
    this.nodeValue = String(value)
  }
}

class TestComment extends TestNode {
  constructor(value, ownerDocument) {
    super(8, '#comment', ownerDocument)
    this.nodeValue = String(value)
  }
}

class TestDocument extends TestNode {
  constructor() {
    super(9, '#document', null)
    this.ownerDocument = this
    this.documentElement = new TestElement('html', this)
    this.body = new TestElement('body', this)
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
    this.activeElement = this.body
  }

  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(value) { return new TestText(value, this) }
  createComment(value) { return new TestComment(value, this) }
  getSelection() { return null }
}

export function installWarehouseReactDom() {
  const previous = new Map()
  const document = new TestDocument()
  const window = {
    document,
    Event: TestEvent,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLIFrameElement: class extends TestElement {},
    getComputedStyle: () => ({}),
  }
  document.defaultView = window
  const replacements = {
    document,
    window,
    self: window,
    Event: TestEvent,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [name, value] of Object.entries(replacements)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  }
  return {
    document,
    createContainer() {
      const container = document.createElement('div')
      document.body.appendChild(container)
      return container
    },
    cleanup() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    },
  }
}

export function findWarehouseTestElement(root, predicate) {
  if (root?.nodeType === 1 && predicate(root)) return root
  for (const child of root?.childNodes ?? []) {
    const match = findWarehouseTestElement(child, predicate)
    if (match) return match
  }
  return null
}
