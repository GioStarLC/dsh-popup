/**
 * Contract and logic check for lib/client.js — run it after every edit:
 *
 *   node tools/check-client-bundle.mjs
 *
 * Two things it covers, both of which cost a restart to discover otherwise:
 *
 *   1. Boot safety. It evaluates the bundle the way the DSH module loader
 *      does (capture the registered factory), RUNS the factory, then runs its
 *      apply() against a stubbed Client context. A factory-body
 *      ReferenceError is exactly what fails the host's web boot audit
 *      ("<row>: import failed"), and a Client entry that fails to activate
 *      blocks the whole boot — not just this plugin.
 *
 *   2. Anchor round-tripping. Marks are stored as (flow-item key, quote,
 *      context) and their Range is re-derived from the DOM on every repaint,
 *      because the transcript unmounts off-screen items and re-renders a
 *      streaming answer continuously. Getting that wrong paints the wrong
 *      sentence, which is worse than painting nothing, so the projection and
 *      the locator are exercised against a small hand-built node tree.
 *
 * The node tree is not a rendering harness: no component is ever mounted and
 * nothing is drawn. It only stands in for the DOM reads the locator makes.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '..', 'lib', 'client.js')
const EXPECTED_ID = 'dsh-popup'
const EXPECTED_SEATS = [
  'shell.overlay#select-consent',
  'conversation.input.dock#select-consent-bridge',
  'conversation.input.left#select-consent-insert',
]

const fail = (message) => {
  console.error('FAIL:', message)
  process.exit(1)
}

const check = (condition, message) => {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------------------
// a node tree just large enough for the locator
// ---------------------------------------------------------------------------

function text(data) {
  return { nodeType: 3, data }
}

function element(tagName, children, attrs) {
  const node = {
    nodeType: 1,
    tagName,
    childNodes: children,
    parent: null,
    hidden: false,
    attrs: attrs || {},
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    },
    /** Enough of `closest` for the `[attr]` selectors the module uses. */
    closest(selector) {
      const name = selector.slice(1, -1)
      let current = this
      while (current !== null && current.nodeType === 1) {
        if (current.getAttribute(name) !== null) return current
        current = current.parent
      }
      return null
    },
  }
  for (const child of children) {
    if (child !== null && typeof child === 'object') child.parent = node
  }
  return node
}

/** Every Range the module asked for, so endpoints can be asserted. */
const ranges = []
function createRange() {
  const range = {
    start: null,
    end: null,
    setStart(node, offset) {
      range.start = { node, offset }
    },
    setEnd(node, offset) {
      range.end = { node, offset }
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }
    },
    getClientRects() {
      return []
    },
  }
  ranges.push(range)
  return range
}

/**
 *   <div data-chat-anchor-key="k1">
 *     <p>Hello <b>world</b>!</p>
 *     <p>Second line</p>
 *   </div>
 *
 * Packed: "Helloworld!Secondline"  (block separators and spaces dropped)
 */
const helloText = text('Hello ')
const worldText = text('world')
const bangText = text('!')
const secondText = text('Second ')
const lineText = text('line')
const anchorElement = element(
  'DIV',
  [
    element('P', [helloText, element('B', [worldText]), bangText]),
    element('P', [secondText, lineText]),
  ],
  { 'data-chat-anchor-key': 'k1' }
)

/** The Conversation that owns the anchor; marks are filed under its id. */
element('DIV', [anchorElement], { 'data-conversation-session': 's1' })

const localStorageData = new Map()

// ---------------------------------------------------------------------------
// the sandbox the loader contract needs
// ---------------------------------------------------------------------------

let captured = null
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load: (def) => {
        captured = def
      },
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    getSelection: () => null,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: () => {},
    innerWidth: 1200,
    innerHeight: 800,
    localStorage: {
      getItem: (key) => (localStorageData.has(key) ? localStorageData.get(key) : null),
      setItem: (key, value) => localStorageData.set(key, String(value)),
    },
    Highlight: class {
      constructor(...list) {
        this.ranges = list
      }
    },
    CSS: { highlights: { set() {}, delete() {} } },
  },
  document: {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === '[data-chat-anchor-key]' ? [anchorElement] : []),
    addEventListener: () => {},
    removeEventListener: () => {},
    createRange,
    activeElement: null,
  },
  setTimeout,
  clearTimeout,
  DataTransfer: class {
    setData() {}
  },
  ClipboardEvent: class {},
}

try {
  runInNewContext(readFileSync(FILE, 'utf8'), sandbox, { filename: FILE })
} catch (error) {
  fail(`bundle did not evaluate: ${error.constructor.name}: ${error.message}`)
}

// ---------------------------------------------------------------------------
// 1. the module contract
// ---------------------------------------------------------------------------

check(captured !== null, 'no factory registered with window.__ModuleLoader__')
check(captured.id === EXPECTED_ID, `factory id is "${captured.id}", expected "${EXPECTED_ID}"`)

// Only the hooks the module body touches at factory-execution time. The
// popup's first state is its open card and its second is a Session revision;
// `hooks.firstState` lets a check open a card without mounting anything.
const hooks = { firstState: undefined }
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (value) => {
    if (hooks.firstState !== undefined) {
      const preset = hooks.firstState
      hooks.firstState = undefined
      return [preset, () => {}]
    }
    return [value, () => {}]
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (value) => ({ current: value }),
}
const ReactDOM = {
  // The bubble is portalled to document.body; the check never draws it, so a
  // stand-in that returns the node untouched is enough.
  createPortal: (node) => node,
}
const requireStub = (name) => {
  if (name === 'react') return React
  if (name === 'react-dom') return ReactDOM
  throw new Error(`unexpected require("${name}")`)
}

let exported
try {
  exported = captured.factory(requireStub)
} catch (error) {
  fail(`factory threw: ${error.constructor.name}: ${error.message}`)
}

for (const key of ['name', 'inject', 'apply']) {
  check(key in exported, `exports missing "${key}"`)
}
check(typeof exported.apply === 'function', 'exports.apply is not a function')

const registered = []
const ctx = {
  effect: (fn) => fn(),
  get: () => undefined,
  slots: {
    inject: (key, cb) => {
      cb()
      return () => {}
    },
    register: (options, component) => {
      registered.push({ options, component })
      return () => {}
    },
  },
  locale: { register: () => () => {}, bind: () => (key) => key },
}

try {
  exported.apply(ctx)
} catch (error) {
  fail(`apply threw: ${error.constructor.name}: ${error.message}`)
}

const seats = registered.map((entry) => `${entry.options.name}#${entry.options.id}`).sort()
for (const seat of EXPECTED_SEATS) {
  check(seats.includes(seat), `seat not registered: ${seat}`)
}
for (const entry of registered) {
  check(typeof entry.component === 'function', `${entry.options.id}: component is not a function`)
}

// Component bodies, hooks stubbed, effects never run. This only proves each
// component's top level evaluates and renders nothing visible while idle.
const props = {
  t: (key) => key,
  input: { draft: 'existing draft' },
  inputActions: { setDraft() {} },
  sessionId: 's1',
}

const byId = {}
for (const entry of registered) byId[entry.options.id] = entry

/** Every button in a rendered tree, in order. */
function buttonsOf(tree) {
  const out = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (node === null || node === undefined || typeof node !== 'object') return undefined
    if (node.type === 'button') out.push(node)
    if (Array.isArray(node.kids)) node.kids.forEach(walk)
    return undefined
  }
  walk(tree)
  return out
}


/** Render one seat's component, reporting which one threw. */
function render(id, seatProps) {
  const entry = byId[id]
  check(entry !== undefined, `seat "${id}" was not registered`)
  try {
    return entry.component(seatProps)
  } catch (error) {
    fail(`${id} threw on first render: ${error.constructor.name}: ${error.message}`)
  }
}

// Component bodies, hooks stubbed, effects never run. This only proves each
// component's top level evaluates.
check(render('select-consent-bridge', props) === null, 'the bridge must render nothing')
// The insert button is resident: it renders in every state, so a reader can see
// where quotes go before they have any. Its *state* is what changes.
const idleButton = render('select-consent-insert', props)
check(idleButton !== null, 'the insert button must be drawn even with nothing pending')
check(
  buttonsOf(idleButton)[0].props['data-ready'] === 'false',
  'an empty Session must draw the button in its idle state'
)

const popupTree = render('select-consent', props)
check(popupTree !== null, 'the popup must always render its stylesheet')
check(popupTree.type === React.Fragment, 'the popup idle render should be a Fragment')
check(
  popupTree.kids[0].type === 'style',
  'the popup idle render must hold the mark stylesheet first'
)

const markCss = String(popupTree.kids[0].kids[0])
check(
  markCss.includes('::highlight(dsh-select-consent-mark)'),
  'the stylesheet must style the mark highlight'
)
// A custom property is not reliably inherited into a highlight pseudo-element,
// so the highlight rule itself must carry literal colours. Popup rules may use
// theme tokens; inspect only the ::highlight() rule here.
const highlightCss = markCss.match(/::highlight\([^)]*\)\{[^}]*\}/)?.[0] || ''
check(
  highlightCss !== '' && !highlightCss.includes('var('),
  'the highlight rule must not depend on var() resolving inside a highlight pseudo'
)
check(
  /background-color:\s*rgba\(255,\s*2\d\d,/.test(highlightCss),
  'the highlight must be a warm yellow literal'
)
check(
  /[;{]\s*color:\s*#/.test(markCss),
  'the highlight must pin the text colour so one rule reads on both themes'
)

// ---------------------------------------------------------------------------
// 2. the anchoring projection and the locator
// ---------------------------------------------------------------------------

const api = sandbox.window.__dshSelectConsent
check(api !== undefined, 'the debug surface was not published')

check(api.pack('a b\nc') === 'abc', 'pack must drop all whitespace')

const full = api.packedMapOf(anchorElement)
check(full.packed === 'Helloworld!Secondline', `packedMapOf produced "${full.packed}"`)
check(full.map.length === full.packed.length * 2, 'packedMapOf must keep one offset pair per character')

const located = api.locate(full, {
  key: 'k1',
  quote: 'world!',
  prefix: 'Hello',
  suffix: 'Secondline',
  index: 5,
})
check(located !== null, 'the quote must be located')
check(located.start === 5 && located.end === 11, `located span was ${JSON.stringify(located)}`)

// The projection must survive the browser's block separators: a selection
// spanning both paragraphs packs to the same text as the DOM walk.
const spanning = api.locate(full, {
  key: 'k1',
  quote: api.pack('world!\nSecond'),
  prefix: 'Hell',
  suffix: 'line',
  index: 5,
})
check(
  spanning !== null && spanning.start === 5 && spanning.end === 17,
  `a quote spanning a block boundary was not located: ${JSON.stringify(spanning)}`
)

// A hand-edited or half-written record must degrade, not throw.
check(
  api.locate(full, { quote: 'world!' }) !== null,
  'a mark with no stored context must still locate by quote alone'
)
check(api.locate(full, { quote: '' }) === null, 'an empty quote must not locate')
check(api.locate(full, null) === null, 'a null mark must not locate')

// Ambiguity must be refused rather than guessed.
const twice = { packed: 'abcXYZabcXYZ', map: [] }
check(
  api.locate(twice, { quote: 'abc', prefix: 'zz', suffix: 'zz', index: 0 }) === null,
  'an ambiguous quote with no context match must be refused'
)
check(
  api.locate(twice, { quote: 'abc', prefix: '', suffix: 'XYZabc', index: 0 }) !== null,
  'an ambiguous quote with matching context must be located'
)

// ---------------------------------------------------------------------------
// 3. what an open card offers
// ---------------------------------------------------------------------------

/** The children of a rendered card's box, flattened. */
function childrenOf(tree) {
  const boxes = tree.kids.filter((child) => child !== null && child.type === 'div')
  // The card's own box is the last direct div: the overlay may render other
  // layout before it, and the box always comes after them.
  const box = boxes[boxes.length - 1]
  if (box === undefined) return []
  // The card's chrome is built as arrays of children (the note box and the card
  // share one placement effect that way), and `createElement` keeps an array
  // argument as one child slot — exactly like React does. Flatten deeply so a
  // check can look at elements rather than at the shape they were passed in.
  const flat = []
  const push = (child) => {
    if (Array.isArray(child)) {
      for (const one of child) push(one)
      return
    }
    if (child === null || child === undefined || child === false) return
    flat.push(child)
  }
  for (const child of box.kids) push(child)
  return flat
}

/** The button labels a rendered card offers, left to right. */
const labelsOf = (tree) =>
  childrenOf(tree)
    .filter((child) => child !== null && child.type === 'button')
    .map((button) => button.kids[0])

/**
 * Every element of a rendered card's box, at any depth.
 *
 * `childrenOf` only reaches the direct children, which is enough for the card
 * but not for the note box: it is a column (quick answers, then the input), so
 * its parts are one row deeper.
 */
function descendantsOf(tree) {
  const out = []
  const push = (node) => {
    if (node === null || node === undefined || node === false) return
    if (Array.isArray(node)) {
      for (const one of node) push(one)
      return
    }
    if (typeof node !== 'object') return
    out.push(node)
    if (Array.isArray(node.kids)) for (const kid of node.kids) push(kid)
  }
  for (const child of tree.kids) push(child)
  return out
}

const popup = registered.find((entry) => entry.options.id === 'select-consent')
const baseCard = {
  kind: 'agree',
  text: 'the passage',
  box: { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 },
}

// Everything a passage can be answered with is on the first layer: the two
// answers commit immediately, 「标记」 commits a pick with no note, and the input
// is the slower path to the same quotation. There is no second card to reach for.
hooks.firstState = { ...baseCard, anchor: { key: 'k1' }, editing: null, note: '' }
let card = popup.component(props)
const cardLabels = descendantsOf(card)
  .filter((child) => child.type === 'button')
  .map((button) => button.props['data-answer'] || button.kids[0])
// Agree leads, disagree follows: the affirmative is the answer most passages get,
// and it should sit where the eye lands first.
check(
  cardLabels.join(',') === 'agree,disagree,mark',
  `the card should offer agree, then disagree, then the mark action, got ${cardLabels.join(',')}`
)

const noteBox = descendantsOf(card).find((child) => child.type === 'textarea')
check(noteBox !== undefined, 'the card must carry the custom input on its first layer')
check(noteBox.props.value === '', 'a fresh card must start with an empty input')
check(
  noteBox.props['data-select-consent-note'] === 'true',
  'the note input must be marked so it is never treated as a foreign field'
)
check(
  noteBox.props.placeholder === 'notePlaceholder',
  'the note input must show concise guidance'
)
check(
  noteBox.props.className === 'dsh-select-consent-note',
  'the note input must use the compact themed input treatment'
)
check(
  markCss.includes('.dsh-select-consent-quick--agree') &&
    markCss.includes('.dsh-select-consent-quick--disagree') &&
    markCss.includes('.dsh-select-consent-note:focus'),
  'the card must visually distinguish the primary answer and the focused input'
)

// The order is the contract: 「同意」, 「不同意」, 「标记」, then the field.
const boxButtons = descendantsOf(card).filter((child) => child.type === 'button')
check(
  boxButtons
    .filter((child) => child.props['data-answer'] !== undefined)
    .map((button) => button.props['data-answer'])
    .join(',') === 'agree,disagree',
  'the answers must be ordered 「同意」 then 「不同意」'
)
check(
  boxButtons
    .filter((child) => child.props['data-answer'] !== undefined)
    .every((button, index) =>
      button.props.className ===
        'dsh-select-consent-quick dsh-select-consent-quick--' +
          (index === 0 ? 'agree' : 'disagree') &&
      button.kids[0].type === 'span' &&
      button.kids[0].props['aria-hidden'] === 'true' &&
      button.kids[0].kids[0] === (index === 0 ? 'agreeEmoji' : 'disagreeEmoji')
    ),
  'quick answers must show 👍/👎 while keeping the stored response text separate'
)
const visualOrder = descendantsOf(card).filter(
  (child) => child.type === 'button' || child.type === 'textarea'
)
check(
  visualOrder.filter((child) => child.type === 'button').length === 3 &&
    visualOrder[visualOrder.length - 1].type === 'textarea',
  'the answers and the mark must sit above the input, all on the same card'
)

// A click on an existing mark offers only its removal.
hooks.firstState = {
  ...baseCard,
  kind: 'marked',
  mark: { id: 'm1' },
  sessionId: 's1',
}
card = popup.component(props)
check(
  labelsOf(card).join(',') === 'unmark',
  `a marked passage should offer only unmarking, got ${labelsOf(card).join(',')}`
)

// ---------------------------------------------------------------------------
// 4. the quote format
// ---------------------------------------------------------------------------

check(api.quoteBlock('hello') === '> hello', 'a single line must be one quoted line')
check(api.quoteBlock('a\nb') === '> a\n> b', 'every line must be quoted')
check(
  api.quoteBlock('a\n\nb') === '> a\n>\n> b',
  'a blank line inside a quote must stay inside it'
)

// A pick and its note: the quote, then a blank line, then the reader's own
// words. The blank line is not cosmetic — a non-blank line after a blockquote
// is a lazy continuation, so the note would otherwise be read as model text.
// 「引用」 without a note is a bare quote block and nothing else — no blank
// line, no dangling separator for a note that was never written.
const bareQuote = [{ key: 'k1', quote: 'q', text: 'q', note: '', quoted: true }]
check(
  api.buildAggregate(bareQuote) === '> q\n\n',
  `a pure quote must be one block, got ${JSON.stringify(api.buildAggregate(bareQuote))}`
)

const oneNote = [{ key: 'k1', quote: 'q', text: 'q', note: 'my note' }]
check(
  api.composeAggregate('', oneNote) === '> q\n我的回答：my note\n\n',
  `a note must follow its quote, labelled, got ${JSON.stringify(api.composeAggregate('', oneNote))}`
)
// The label is what keeps the note from being a lazy continuation of the quote:
// without it a plain line under a blockquote reads as more of the model's text.
check(
  api.composeAggregate('', oneNote).includes('我的回答：'),
  'a note must be labelled as the reader’s own answer'
)

// An existing draft keeps its place above the inserted set, and a draft already
// ending in a break must not grow a second one.
check(
  api.composeAggregate('already typed', oneNote).startsWith('already typed\n> q'),
  'an existing draft keeps the picked set underneath it'
)
check(
  api.composeAggregate('already typed\n', oneNote).startsWith('already typed\n> q'),
  'a draft already ending in a break must not double it'
)

// A pick with no note says what was chosen, not what is being said: it is not
// handed over. This is the whole difference between 标记 and 引用并附注.
const barePick = [{ key: 'k1', quote: 'q', text: 'q', note: '', quoted: false }]
check(
  api.composeAggregate('', barePick) === null,
  'a bare 标记 must contribute nothing to the composer'
)

// …and `quoted` alone is enough: a pick with no note still goes in.
check(
  api.composeAggregate('', bareQuote) !== null,
  'a pure 引用 must be handed over even though it carries no note'
)

// ---------------------------------------------------------------------------
// 4. derive: anchors become painted ranges, and storage round-trips
// ---------------------------------------------------------------------------

const anchor = { key: 'k1', quote: 'world!', prefix: 'Hello', suffix: 'Secondline', index: 5 }

api.addMark('s1', anchor)
const stored = api.marks('s1')
check(stored.length === 1, `expected one stored mark, got ${stored.length}`)

// The same anchor twice is the same mark, not two.
api.addMark('s1', anchor)
check(api.marks('s1').length === 1, 're-marking the same span must not duplicate')

// Marks are per Session.
check(api.marks('s2').length === 0, 'marks must not leak between Sessions')

const derived = api.derive('s1', api.marks('s1'))
check(derived.length === 1, `expected one derived range, got ${derived.length}`)
check(derived[0].range.start.node === worldText, 'the derived range must start in the "world" node')
check(derived[0].range.start.offset === 0, 'the derived range must start at offset 0 of "world"')
check(derived[0].range.end.node === bangText, 'the derived range must end in the "!" node')
check(derived[0].range.end.offset === 1, 'the derived range must end after "!"')

// Anchor keys are turn/step derived, so two Sessions can share one. A
// transcript mounted for another Session must never receive these marks.
check(
  api.derive('s2', api.marks('s1')).length === 0,
  'marks must not be painted into another Session that shares an anchor key'
)

// A mark whose text is gone paints nothing, and does not throw.
const stale = api.derive('s1', [
  { id: 'x', key: 'k1', quote: 'not present', prefix: '', suffix: '', index: 0 },
])
check(stale.length === 0, 'a mark that cannot be located must paint nothing')

api.removeMark('s1', stored[0].id)
check(api.marks('s1').length === 0, 'removeMark must forget the mark')
check(api.derive('s1', api.marks('s1')).length === 0, 'nothing may stay painted after the last mark goes')

// ---------------------------------------------------------------------------
// 5. the aggregate exit: pick several, hand them over once
// ---------------------------------------------------------------------------

const picked = [
  { key: 'k1', quote: 'aa', prefix: '', suffix: '', index: 0, text: '第一步：用 Redis\n运维成本高', quoted: true },
  { key: 'k1', quote: 'bb', prefix: '', suffix: '', index: 9, text: '第三步：不缓存', quoted: true },
]

api.addMark('agg', picked[0])
api.addMark('agg', picked[1])
const aggMarks = api.marks('agg')
check(aggMarks.length === 2, `expected two picked marks, got ${aggMarks.length}`)
check(api.pending(aggMarks).length === 2, 'a fresh mark starts unhanded to the composer')

// Each pick is its own quote block, so "these two of your five" reads as two
// chosen things rather than one long quotation.
aggMarks[0].note = '这条我认同'
aggMarks[1].note = '这条不认同'
const aggregated = api.buildAggregate(aggMarks)
check(
  aggregated ===
    '> 第一步：用 Redis\n> 运维成本高\n我的回答：这条我认同\n\n> 第三步：不缓存\n我的回答：这条不认同\n\n',
  `unexpected aggregate:\n${JSON.stringify(aggregated)}`
)

// Two annotated picks and one bare pick: the bare one is not handed over, and
// the count still knows it is there.
const mixed = [
  { key: 'k1', quote: 'aa', text: 'aa', note: '第一条', quoted: true },
  { key: 'k1', quote: 'bb', text: 'bb', note: '', quoted: false },
  { key: 'k1', quote: 'cc', text: 'cc', note: '', quoted: true },
]
check(
  api.quotableOf(mixed).length === 2,
  'quotableOf must keep the quoted picks and drop the bare 标记'
)
check(
  api.buildAggregate(mixed) === '> aa\n我的回答：第一条\n\n> cc\n\n',
  `a bare 标记 must be skipped without disturbing the order of the others, got ${JSON.stringify(api.buildAggregate(mixed))}`
)

// Handing them over once must not hand them over again.
api.markExported('agg', aggMarks.map((mark) => mark.id))
check(api.pending(api.marks('agg')).length === 0, 'a handed-over mark must stop being pending')
check(
  api.buildAggregate(api.pending(api.marks('agg'))) === '',
  'nothing pending must contribute nothing'
)

// A mark with no stored verbatim text still has its projection, and is used
// rather than dropped silently.
const fallback = api.buildAggregate([{ quote: 'fallbacktext', text: undefined, note: 'x', quoted: true }])
check(
  fallback === '> fallbacktext\n我的回答：x\n\n',
  `a mark without text must fall back, got ${JSON.stringify(fallback)}`
)

// ---------------------------------------------------------------------------
// 5b. unmarking takes its block back out of the draft
// ---------------------------------------------------------------------------
//
// The composer has no "delete a range": a withdrawal has to rebuild the whole
// draft with `setDraft`. This section proves the three halves of that bargain —
// the block is found and removed byte for byte, a draft that was edited is left
// alone, and a draft the plugin cannot rewrite safely is refused rather than
// guessed at.

const rewritten = []
api.bridge.sessionId = 'withdraw'
api.bridge.chips = 0
api.bridge.phase = 'plain'
api.bridge.actions = {
  insertText: () => true,
  captureInsertion: () => ({ start: 0, end: 0 }),
  setDraft: (text) => {
    rewritten.push(text)
    return true
  },
}

const withdrawalMark = api.addMark(
  'withdraw',
  { key: 'k1', quote: 'ww', prefix: '', suffix: '', index: 0, text: '原文', quoted: true },
  '我的看法',
  true
)
const withdrawalBlock = '> 原文\n我的回答：我的看法'
api.markExported('withdraw', [{ id: withdrawalMark.id, chunk: withdrawalBlock + '\n\n' }], '')
const exportedMark = api.marks('withdraw')[0]
api.bridge.draft = withdrawalBlock + '\n\n'

const taken = api.withdraw('withdraw', exportedMark)
check(taken.status === 'removed', `an intact block must be withdrawn, got ${taken.status}`)
check(
  rewritten.length === 1 && rewritten[0] === '',
  `the whole block must leave the draft, got ${JSON.stringify(rewritten)}`
)
check(api.bridge.draft === '', 'the parked draft must follow the rewrite')

// Undo is the plugin's own: `setDraft` merges into the editor's history, so the
// mark and the text have to be restored explicitly.
api.restoreMark('withdraw', exportedMark)
check(api.marks('withdraw').length === 1, 'restoreMark must put the whole record back')
check(
  api.marks('withdraw')[0].exportedChunk === withdrawalBlock + '\n\n',
  'a restored record must keep its export bookkeeping'
)

// A draft that no longer holds the block verbatim is never rewritten.
api.bridge.draft = withdrawalBlock.replace('原文', '原文改') + '\n\n'
rewritten.length = 0
const editedDraft = api.withdraw('withdraw', api.marks('withdraw')[0])
check(
  editedDraft.status === 'changed',
  `an edited block must be refused, got ${editedDraft.status}`
)
check(rewritten.length === 0, 'a refusal must not call setDraft at all')

// A reference chip cannot survive a rebuild, so a chip locks the draft.
api.bridge.draft = withdrawalBlock + '\n\n'
api.bridge.chips = 1
const chipped = api.withdraw('withdraw', api.marks('withdraw')[0])
check(chipped.status === 'locked', `a draft with a chip must be locked, got ${chipped.status}`)
check(rewritten.length === 0, 'a locked draft must not call setDraft')
api.bridge.chips = 0

// The newline the insert added before the batch's first block belongs to the
// block: removing the only block from a draft that had text must leave exactly
// that text, or the composer looks non-empty to the next automatic insert.
api.markExported('withdraw', [{ id: withdrawalMark.id, chunk: withdrawalBlock + '\n\n' }], '\n')
api.bridge.draft = 'draft\n' + withdrawalBlock + '\n\n'
const trimmedBack = api.withdraw('withdraw', api.marks('withdraw')[0])
check(
  trimmedBack.status === 'removed' && rewritten[rewritten.length - 1] === 'draft',
  `the leading newline must go with the block, got ${JSON.stringify(rewritten[rewritten.length - 1])}`
)

// ---------------------------------------------------------------------------
// 6. the insert button
// ---------------------------------------------------------------------------

const insert = registered.find((entry) => entry.options.id === 'select-consent-insert')
check(insert !== undefined, 'the insert button seat must be registered')
check(
  insert.options.name === 'conversation.input.left',
  `the button must sit in the composer tool row, got ${insert.options.name}`
)

// Its own Session, so this section cannot be disturbed by the aggregate one.
const buttonProps = { t: (key) => key, sessionId: 'button' }
api.bridge.sessionId = 'button'
api.bridge.draft = 'a draft'
api.bridge.actions = { insertText: () => true, captureInsertion: () => ({ start: 0, end: 0 }) }

/** Whether a rendered tree contains any element at all. */
const drawsNothing = (tree) => tree === null || tree === undefined

// Nothing picked: no button, no placeholder, no row.
check(
  !drawsNothing(insert.component({ ...buttonProps, sessionId: 'nothing-picked' })),
  'the button is resident: an empty Session still draws it'
)
check(
  buttonsOf(insert.component({ ...buttonProps, sessionId: 'nothing-picked' }))[0].props['data-count'] === '0',
  'an empty Session must show a count of 0'
)

// 「标记」 alone: still nothing. A mark never asks to be written into the
// composer, so it must not summon a button that would do nothing.
api.addMark('mark-only', { key: 'k1', quote: 'dd', prefix: '', suffix: '', index: 0, text: '第七步' })
check(
  buttonsOf(insert.component({ ...buttonProps, sessionId: 'mark-only' }))[0].props['data-count'] === '0',
  'a bare 标记 is not quotable, so it must not raise the count'
)

// 「引用」 with no note: the button appears, because the passage IS the answer.
api.addMark('button', { key: 'k1', quote: 'dd', prefix: '', suffix: '', index: 0, text: '第七步', quoted: true })
let buttonTree = insert.component(buttonProps)
check(!drawsNothing(buttonTree), 'a pending 引用 must draw the insert button')

const buttons = buttonsOf(buttonTree)
// Two controls, one job: the insert button and the auto-insert switch beside it.
check(buttons.length === 2, `the tool row must hold the button and its switch, got ${buttons.length}`)
const insertButton = buttons.filter((node) => node.props['data-select-consent-insert'] !== undefined)[0]
const autoSwitch = buttons.filter((node) => node.props['data-select-consent-auto'] !== undefined)[0]
check(insertButton !== undefined, 'the insert button must be drawn')
check(autoSwitch !== undefined, 'the auto-insert switch must be drawn beside it')
check(
  insertButton.props['data-count'] === '1',
  `a pending 引用 must raise the count, got ${insertButton.props['data-count']}`
)
check(insertButton.props['data-ready'] === 'true', 'a pending 引用 must enable the button')
check(
  insertButton.props['data-select-consent-insert'] === 'true',
  'the button must mark itself for the checks and for debugging'
)
check(
  insertButton.props['aria-label'] === 'insertPicks',
  `the button needs an accessible name, got ${insertButton.props['aria-label']}`
)
// The label is words, and the accessible name is longer than the visible label:
// on screen it is "填入 1", but a screen reader gets the whole sentence.
const visible = JSON.stringify(insertButton.kids)
check(
  visible.includes('insertVerb') && visible.includes('dsh-select-consent-count'),
  `the button must render a verb and a count, got ${visible}`
)
check(
  !visible.includes('"svg"'),
  'the button must carry no icon: a glyph here has to be decoded'
)
// The composer's own tools never take the caret out of the draft.
check(
  typeof insertButton.props.onMouseDown === 'function',
  'the button must handle mouse-down, so answering it does not steal the caret'
)

// The geometry is copied from `dsh-genui`'s prompt toggle so the two sit in one
// row. If these drift the composer tool row starts to look assembled from parts.
const style = insertButton.props.style
check(
  style.height === '28px' && style.minWidth === '28px',
  `the button must be 28 tall like its neighbour, got ${style.height}/${style.minWidth}`
)
check(style.borderRadius === '14px', `the button must be a 14px-radius pill, got ${style.borderRadius}`)
check(style.background === 'transparent', 'the button must be a ghost button')
check(
  style.color === 'var(--dsw-alias-label-secondary)',
  `the button must use the tool-row colour token, got ${style.color}`
)

// Everything handed over: the button goes, and nothing is left in its place.
api.markExported('button', api.marks('button').map((mark) => mark.id))
const doneTree = insert.component(buttonProps)
check(!drawsNothing(doneTree), 'the button stays after everything is handed over')
check(
  buttonsOf(doneTree)[0].props['data-ready'] === 'false',
  'a fully handed-over Session must draw the button idle, not clickable'
)
check(
  buttonsOf(doneTree)[0].props['data-count'] === '1',
  'the count must still show the quoted set after it is handed over'
)

// A composer that cannot accept an insert has nowhere to put the set: draw
// nothing rather than a button whose click would be swallowed.
api.addMark('button', { key: 'k2', quote: 'ee', prefix: '', suffix: '', index: 20, text: '第五步', note: '第五步的看法' })
api.bridge.actions = { insertText: () => true, captureInsertion: () => ({ start: 0, end: 0 }) }

// A note is a quotation too: 「引用并附注」 alone is enough to summon it.
api.addMark('note-only', { key: 'k1', quote: 'ff', prefix: '', suffix: '', index: 0, text: '一段话', note: '我的看法' })
check(
  buttonsOf(insert.component({ ...buttonProps, sessionId: 'note-only' }))[0].props['data-count'] === '1',
  'an annotated pick must be counted as one to insert'
)

console.log('OK:', seats.join(', '))
console.log(
  'OK: card actions, quote format, aggregate exit, insert button, anchoring, locator, storage'
)
