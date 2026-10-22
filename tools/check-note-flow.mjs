/**
 * The browser check for the note flow — run it after every edit that touches
 * the popup:
 *
 *   node tools/check-note-flow.mjs
 *
 * ## Why this exists next to check-client-bundle.mjs
 *
 * `check-client-bundle.mjs` drives the bundle with a stub React in which
 * `useEffect` does nothing. That is enough to prove the module contract — a
 * factory-body `ReferenceError` fails the host's web boot — but it cannot prove
 * the feature works, because almost everything this plugin does lives inside
 * effects and event handlers:
 *
 *   - the popup opens the note box from a `document` mouse-up handler, and a
 *     click that answers the card collapses the page selection, which fires
 *     `selectionchange`. A listener that hides on a collapsed selection hid the
 *     box in the same tick it opened, and the feature read as "the button does
 *     nothing". Every stub-level assertion was green while that was true.
 *   - the box takes focus from an effect keyed to the box's identity, and reads
 *     the textarea through a ref that only exists after the commit phase.
 *   - the note is stored on a keyboard event, and the set is handed to the
 *     composer by a click on a second mounted component.
 *
 * So this check runs the real thing: real React, a real DOM, real events. It
 * mounts both seats, drives a selection, clicks the card, types, presses Enter
 * and Escape, and asserts on what ended up in the marks and in the composer.
 *
 * ## Running it on a fresh clone
 *
 * Playwright is a dev dependency (`npm install`), and Chromium is installed by
 * `npx playwright install chromium`. Both are optional: the check **skips with a
 * notice rather than failing** when either is missing. A missing browser is not
 * a broken plugin, and a check that cannot run must not be mistaken for a check
 * that passed. `DSH_PLAYWRIGHT` and `DSH_CHROMIUM` point it at an install that
 * already lives on the machine instead.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const FILE = join(here, '..', 'lib', 'client.js')

const skip = (why) => {
  console.log('SKIP:', why)
  console.log('SKIP: the note flow was NOT verified by this run')
  process.exit(0)
}

const fail = (message) => {
  console.error('FAIL:', message)
  process.exit(1)
}

const check = (condition, message) => {
  if (!condition) fail(message)
}

// ---------------------------------------------------------------------------
// where Playwright and a browser live
// ---------------------------------------------------------------------------

/**
 * Load Playwright from the environment override first, then from this
 * project's own dependencies. `DSH_PLAYWRIGHT` is for a shared install that is
 * already on the machine; a clone that ran `npm install` needs no override.
 */
async function findPlaywright() {
  const attempts = []
  if (process.env.DSH_PLAYWRIGHT !== undefined) {
    attempts.push(pathToFileURL(process.env.DSH_PLAYWRIGHT).href)
  }
  attempts.push('playwright')
  for (const specifier of attempts) {
    try {
      return await import(specifier)
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'MODULE_NOT_FOUND') {
        throw error
      }
    }
  }
  return null
}

const playwright = await findPlaywright()
if (playwright === null) {
  skip('Playwright is not installed; run `npm install`, or set DSH_PLAYWRIGHT to its index.mjs')
}
const { chromium } = playwright

// Chromium is resolved by Playwright itself, from the cache its own
// `playwright install` populated. `DSH_CHROMIUM` is only for a browser that
// Playwright does not know about; nothing here guesses at OS-specific paths.
const launchOptions = { headless: true }
if (process.env.DSH_CHROMIUM !== undefined) launchOptions.executablePath = process.env.DSH_CHROMIUM

const browser = await chromium.launch(launchOptions).catch((error) => {
  skip(
    'Playwright could not launch Chromium (' + String(error.message).split('\n')[0] + '); ' +
      'run `npx playwright install chromium`, or set DSH_CHROMIUM to a browser binary'
  )
})
const bundle = readFileSync(FILE, 'utf8')

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })

const pageErrors = []
page.on('pageerror', (error) => pageErrors.push('pageerror: ' + error.message))

await page.setContent(
  `<!doctype html><html><body>
     <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
     <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
   </body></html>`,
  { waitUntil: 'networkidle' }
)

const mounted = await page.evaluate((source) => {
  // A `setContent` page has no usable localStorage (the browser denies it to an
  // opaque origin) and the plugin degrades silently by design — so stand one up,
  // or the storage half of the flow would be untestable here.
  const memory = new Map()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key) => (memory.has(key) ? memory.get(key) : null),
      setItem: (key, value) => memory.set(key, String(value)),
      removeItem: (key) => memory.delete(key),
      clear: () => memory.clear(),
    },
  })

  let captured = null
  window.__ModuleLoader__ = { load: (definition) => { captured = definition } }
  try {
    new Function(source)()
  } catch (error) {
    return { fatal: 'bundle did not evaluate: ' + error.message }
  }
  if (captured === null) return { fatal: 'no factory registered' }

  let exports
  try {
    exports = captured.factory((name) => {
      if (name === 'react') return React
      // The insert button's hover bubble portals to document.body. The global
      // ReactDOM is the same build the shell hands a client bundle.
      if (name === 'react-dom') return ReactDOM
      throw new Error('unexpected require("' + name + '")')
    })
  } catch (error) {
    return { fatal: 'factory threw: ' + error.message }
  }

  const registered = []
  try {
    exports.apply({
      effect: (fn) => fn(),
      get: () => undefined,
      slots: {
        inject: (key, cb) => { cb(); return () => {} },
        register: (options, component) => {
          registered.push({ options, component })
          return () => {}
        },
      },
      locale: { register: () => () => {}, bind: () => (key) => key },
    })
  } catch (error) {
    return { fatal: 'apply threw: ' + error.message }
  }

  document.body.insertAdjacentHTML(
    'beforeend',
    '<div data-conversation-session="s1" style="padding:100px">' +
      // An earlier turn. The plugin answers one message at a time, so this
      // paragraph must never grow a peek button even though it is selectable.
      '<div data-chat-turn="1" data-chat-flow-kind="assistant-step" data-chat-node-key="step:1" data-chat-anchor-key="k0">' +
      '<p id="p0" style="font-size:16px">Earlier answer that is not being answered</p></div>' +
      // The newest assistant reply: the only scope that may be quoted.
      '<div data-chat-turn="2" data-chat-flow-kind="assistant-step" data-chat-node-key="step:2" data-chat-anchor-key="k1">' +
      '<p id="p1" style="font-size:16px">Hello world! Second line</p></div>' +
      // The same assistant step, mounted as a second group part. It shares
      // the node key but not the anchor, and the split reply must still be
      // one scope.
      '<div data-chat-turn="2" data-chat-group-part="reasoning" data-chat-node-key="step:2" ' +
      'data-chat-anchor-key="group:step:2:reasoning"><p id="p2" style="font-size:16px">Reasoning part of the same reply</p></div>' +
      '</div>' +
      // The composer's editable root. `composerRoot()` looks for the Lexical
      // marker, and the auto-insert path hangs off focus landing here.
      '<div class="dsh-composer-anchor" aria-expanded="false">' +
      '<div data-lexical-editor="true" contenteditable="true" tabindex="0" ' +
      'style="min-height:40px;outline:1px dashed #ccc">draft</div></div>' +
      '<div id="popup-host"></div><div id="button-host"></div>' +
      // The transcript is taller than the viewport in the real app; a spacer
      // keeps that true here so a scroll can actually be driven.
      '<div style="height:2000px"></div>'
  )

  const t = (key) => key
  const popup = registered.find((entry) => entry.options.id === 'select-consent')
  const insert = registered.find((entry) => entry.options.id === 'select-consent-insert')
  if (popup === undefined || insert === undefined) return { fatal: 'seats were not registered' }

  ReactDOM.createRoot(document.getElementById('popup-host')).render(
    React.createElement(popup.component, { t })
  )
  ReactDOM.createRoot(document.getElementById('button-host')).render(
    React.createElement(insert.component, { t, sessionId: 's1' })
  )

  window.__inserted = []
  window.__setDraft = []
  const bridge = window.__dshSelectConsent.bridge
  bridge.sessionId = 's1'
  bridge.draft = ''
  bridge.actions = {
    captureInsertion: () => ({ start: 0, end: 0 }),
    insertText: (text) => { window.__inserted.push(text); return true },
    setDraft: (text) => { window.__setDraft.push(text); return true },
  }
  return { ok: true }
}, bundle)

if (mounted.fatal !== undefined) fail(mounted.fatal)

// ---------------------------------------------------------------------------
// driving it
// ---------------------------------------------------------------------------

/** Put `[from, to)` of a paragraph in the page's selection. */
async function setSelectionIn(id, from, to) {
  await page.evaluate(([paragraph, a, b]) => {
    const text = document.getElementById(paragraph).firstChild
    const range = document.createRange()
    range.setStart(text, a)
    range.setEnd(text, b)
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  }, [id, from, to])
}

/** Put `[from, to)` of the newest reply's paragraph in the selection. */
async function setSelection(from, to) {
  await setSelectionIn('p1', from, to)
}

/**
 * Select `[from, to)`, run the mouse-up, and wait for the faint word to appear.
 *
 * It is deliberately not the card: a mouse-up is ambiguous, so the plugin waits
 * `PEEK_DELAY_MS` before drawing anything, and draws a faint word rather than
 * the card.
 */
async function selectOnly(from, to) {
  await setSelection(from, to)
  await page.mouse.move(200, 120)
  await page.mouse.up()
  await page.waitForSelector('[data-select-consent-peek]', { timeout: 2000 })
}

/** Open the card the way a reader does: click the faint word. */
async function openCard() {
  await page.evaluate(() => {
    const peek = document.querySelector('[data-select-consent-peek]')
    if (peek === null) throw new Error('no faint word is showing')
    peek.click()
  })
  await page.waitForSelector('[data-select-consent-popup]', { timeout: 2000 })
  await page.waitForTimeout(60)
}

/** The ordinary way in: select, then pick the word. */
async function select(from, to) {
  await selectOnly(from, to)
  await openCard()
}

/** Click one of the card's buttons by its `data-answer` (or `mark` for 标记). */
const clickAnswer = (which) =>
  page.evaluate((selector) => {
    const card = document.querySelector('[data-select-consent-popup]')
    if (card === null) throw new Error('no card is open')
    const button =
      selector === 'mark'
        ? [...card.querySelectorAll('button')].find(
            (candidate) => candidate.getAttribute('data-answer') === null
          )
        : card.querySelector(`[data-answer="${selector}"]`)
    if (button === undefined || button === null) throw new Error(`no "${selector}" button`)
    button.click()
  }, which)

const marks = () =>
  page.evaluate(() =>
    window.__dshSelectConsent.marks('s1').map((mark) => ({ quote: mark.quote, note: mark.note }))
  )

const boxOpen = () => page.evaluate(() => document.querySelector('[data-select-consent-note]') !== null)

/** A click on something outside the popup, which is how a reader leaves the box. */
const clickOutside = () =>
  page.evaluate(() =>
    document
      .querySelector('.dsh-composer-anchor')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  )

// --- 0. the button is resident from the very first paint --------------------
// It is how a reader learns the feature exists, so it must be there before
// anything is picked — showing 0, and not clickable.
await page.waitForSelector('[data-select-consent-insert]', { timeout: 2000 })
const atRest = await page.evaluate(() => {
  const button = document.querySelector('[data-select-consent-insert]')
  return button === null
    ? null
    : {
        count: button.getAttribute('data-count'),
        ready: button.getAttribute('data-ready'),
        label: button.getAttribute('aria-label'),
        pulse: button.getAttribute('data-pulse'),
        text: button.textContent,
        svgs: button.querySelectorAll('svg').length,
      }
})
check(atRest !== null, 'the insert button must be drawn before anything is picked')
check(atRest.count === '0', `a fresh Session must show 0, got ${atRest.count}`)
check(atRest.ready === 'false', 'a button with nothing to insert must not be clickable')
check(
  atRest.label === 'insertPicksEmpty',
  `an idle button must explain how to use it, got ${atRest.label}`
)
// Words, not a glyph: an icon had to be decoded, so the label states the verb.
check(
  atRest.text === 'insertVerb0',
  `the button must read as a verb plus its count, got ${JSON.stringify(atRest.text)}`
)
check(
  atRest.svgs === 0,
  `the button must carry no icon at all, got ${atRest.svgs} svg(s)`
)
check(
  atRest.pulse === null,
  'the first paint must not pulse: nothing has changed yet'
)
// The pulse is a stylesheet, and it has to be in the document for the animation
// to exist at all.
check(
  (await page.evaluate(
    () => document.querySelector('[data-select-consent-pulse-style]') !== null
  )),
  'the pulse stylesheet must be mounted with the button'
)

/** Clicking an idle button must do nothing at all. */
await page.evaluate(() => document.querySelector('[data-select-consent-insert]').click())
await page.waitForTimeout(200)
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'clicking the idle button must insert nothing'
)

// --- 0b. the button comes with the mouse-up, not after it -------------------
// A control that arrives late reads as a stray artefact appearing from nowhere,
// so there is no dwell. What replaces it is the fact that this is a 32px circle
// with no focus and no paint: being early costs the reader nothing.
await page.evaluate(() => {
  window.__upAt = 0
  window.__peekAt = null
  document.addEventListener('mouseup', () => { window.__upAt = performance.now() }, true)
  const watch = () => {
    if (window.__peekAt === null && document.querySelector('[data-select-consent-peek]')) {
      window.__peekAt = performance.now()
    }
    requestAnimationFrame(watch)
  }
  requestAnimationFrame(watch)
})
await setSelection(6, 12)
await page.mouse.move(200, 120)
await page.mouse.up()
await page.waitForTimeout(250)
const latency = await page.evaluate(() => ({
  up: window.__upAt,
  at: window.__peekAt,
  card: document.querySelector('[data-select-consent-popup]') !== null,
  preview: window.CSS.highlights.has('dsh-select-consent-preview'),
}))
check(latency.at !== null, 'the mouse-up must draw the button')
check(
  latency.at - latency.up < 100,
  `the button must arrive with the mouse-up, took ${Math.round(latency.at - latency.up)}ms`
)
check(!latency.card, 'the mouse-up must draw the button, not the card')
console.log('   peek latency:', Math.round(latency.at - latency.up) + 'ms', '(mouse-up → button on screen)')
check(!latency.preview, 'the mouse-up must not paint the passage')

// Keeping the hand moving is no longer a reason to hide it — the button is
// cheap enough to ignore — but scrolling still is: it is tied to a place.
await page.mouse.move(340, 260, { steps: 5 })
await page.waitForTimeout(120)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') !== null),
  'moving the pointer must not make the button disappear under it'
)
await page.evaluate(() => window.scrollTo(0, 40))
await page.waitForTimeout(150)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') === null),
  'scrolling must take the button with it, because it belongs to a place'
)
await page.evaluate(() => window.scrollTo(0, 0))

// --- 0b-2. an earlier turn is outside the reply being answered --------------
// The composer's draft answers the newest message. A passage from an earlier
// turn is still readable and can still be copied, but it must not offer to join
// this reply: no button, no card, no mark.
await setSelectionIn('p0', 0, 7)
await page.mouse.move(200, 120)
await page.mouse.up()
await page.waitForTimeout(300)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') === null),
  'a selection in an earlier turn must not draw a peek button'
)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-popup]') === null),
  'a selection in an earlier turn must not open the card'
)

// Virtualization unmounts off-screen flow items. When the newest reply is gone
// from the DOM but an older turn is still mounted, the remembered scope must
// keep the older turn out instead of promoting it to "newest".
await page.evaluate(() => {
  const latest = document.querySelector('[data-chat-flow-kind="assistant-step"][data-chat-node-key="step:2"]')
  window.__latestFlowKind = latest.getAttribute('data-chat-flow-kind')
  latest.setAttribute('data-chat-flow-kind', 'unmounted-step')
})
await setSelectionIn('p0', 0, 7)
await page.mouse.move(200, 120)
await page.mouse.up()
await page.waitForTimeout(300)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') === null),
  'an older reply must not become the scope when the newest one is unmounted'
)
await page.evaluate(() => {
  const latest = document.querySelector('[data-chat-node-key="step:2"][data-chat-flow-kind="unmounted-step"]')
  latest.setAttribute('data-chat-flow-kind', window.__latestFlowKind)
})

// The same reply may be split across group parts with different anchors but
// one node key; a passage in the other part is still part of this reply.
await setSelectionIn('p2', 0, 9)
await page.mouse.move(200, 120)
await page.mouse.up()
await page.waitForSelector('[data-select-consent-peek]', { timeout: 2000 })
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') !== null),
  'a split group part of the newest reply must still offer the peek button'
)
await page.keyboard.press('Escape')
await page.waitForTimeout(120)

// --- 0c. the peek button: a control, not the card ----------------------------
await selectOnly(6, 12)
const peekState = await page.evaluate(() => {
  const peek = document.querySelector('[data-select-consent-peek]')
  if (peek === null) return null
  const style = getComputedStyle(peek)
  const rect = peek.getBoundingClientRect()
  return {
    tag: peek.tagName,
    label: peek.getAttribute('aria-label'),
    title: peek.getAttribute('title'),
    text: peek.textContent,
    svgs: peek.querySelectorAll('svg').length,
    iconWidth: peek.querySelector('svg') && peek.querySelector('svg').getAttribute('width'),
    animation: style.animationName,
    halo: getComputedStyle(peek, '::before').animationName,
    opacity: parseFloat(style.opacity),
    borderWidth: style.borderTopWidth,
    radius: style.borderTopLeftRadius,
    background: style.backgroundColor,
    shadow: style.boxShadow,
    focused: document.activeElement === peek,
    field: document.querySelector('[data-select-consent-note]') !== null,
    preview: window.CSS.highlights.has('dsh-select-consent-preview'),
    expanded: document.querySelector('.dsh-composer-anchor').getAttribute('aria-expanded'),
    left: rect.left,
    top: rect.top,
    // Layout size, not the animated box: the entrance pop scales the button,
    // and the target is defined before that transform is applied.
    width: peek.offsetWidth,
    height: peek.offsetHeight,
  }
})
check(peekState !== null, 'a selection that holds still must draw the peek button')
check(peekState.tag === 'BUTTON', 'the peek must be a real button, so a keyboard reaches it')
// Icon-only, so the verb has to live on the label rather than in the pixels.
check(
  peekState.label === 'peek',
  `the button must carry its verb as a label, got ${JSON.stringify(peekState.label)}`
)
check(
  peekState.svgs === 1 && peekState.text.trim() === '',
  `the button must be a drawn glyph, not a word, got text ${JSON.stringify(peekState.text)}`
)
// Quiet is a contrast decision: it still has to read as something pressable.
check(
  peekState.opacity < 0.75,
  `the button must sit back at partial opacity, got ${peekState.opacity}`
)
check(
  peekState.width === 32 && peekState.height === 32,
  `the button must be an easy target without becoming a panel, got ${peekState.width}x${peekState.height}`
)
check(
  peekState.iconWidth === '18',
  `the glyph must grow with the button, got ${peekState.iconWidth}px`
)
check(
  peekState.radius === '50%' || parseFloat(peekState.radius) >= 15,
  `the button must be round, got radius ${peekState.radius}`
)
// Arriving is the one moment this control may move: a small pop says it is
// pressable, and the halo says it once more without covering the sentence.
check(
  peekState.animation === 'dsh-select-consent-peek-in',
  `the peek must pop in, got animation ${peekState.animation}`
)
check(
  peekState.halo === 'dsh-select-consent-peek-halo',
  `the peek must carry one halo, got animation ${peekState.halo}`
)
check(
  parseFloat(peekState.borderWidth) > 0 && peekState.shadow !== 'none',
  'the button must read as a control: an edge and a small shadow'
)
check(peekState.field === false, 'the peek must not be the card')
check(peekState.focused === false, 'the peek must not take the caret')
check(
  peekState.expanded === 'false',
  'the peek must not tell the composer that a popup owns the keyboard'
)
check(
  peekState.preview === false,
  'nothing may be painted into the page before the reader says yes'
)
// It sits clear of the release point, so a hover means the reader moved there
// on purpose rather than the pointer already being on it.
check(
  peekState.left >= 200 + 6 || peekState.top >= 120 + 6,
  `the button must sit clear of the release point, got ${peekState.left},${peekState.top}`
)

// --- 0d. resting on the button opens the card AND takes the caret ----------
await page.mouse.move(peekState.left + peekState.width / 2, peekState.top + peekState.height / 2)
await page.waitForTimeout(350)
const hovered = await page.evaluate(() => {
  const box = document.querySelector('[data-select-consent-popup]')
  const field = box === null ? null : box.querySelector('[data-select-consent-note]')
  return {
    card: box !== null,
    field: field !== null,
    focused: field !== null && document.activeElement === field,
    expanded: document.querySelector('.dsh-composer-anchor').getAttribute('aria-expanded'),
  }
})
check(hovered.card, 'resting on the button must open the card')
check(hovered.field, 'the opened card must carry the field')
// The card exists to be answered, so arriving at it — by hover or by click —
// puts the caret where the next keystroke belongs.
check(hovered.focused, 'the card must take the caret, hover or not')
check(
  hovered.expanded === 'true',
  'the composer must be told a dropdown owns the keyboard while the card has the caret'
)
check(
  await page.evaluate(() => window.CSS.highlights.has('dsh-select-consent-preview')),
  'opening the card must pin the passage, because the caret leaves the selection'
)

// Moving off it does not slam the card shut; clicking away does.
await page.mouse.move(900, 500, { steps: 4 })
await page.waitForTimeout(250)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-popup]') !== null),
  'moving off the card must not make it flicker shut'
)
await page.keyboard.press('Escape')
await page.waitForTimeout(120)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-popup]') === null),
  'Escape must close a card that was only hovered open'
)

// A keyboard can leave the word alone too.
await selectOnly(6, 12)
await page.keyboard.press('Escape')
await page.waitForTimeout(120)
check(
  await page.evaluate(() => document.querySelector('[data-select-consent-peek]') === null),
  'Escape must dismiss the button'
)

// --- 1. the card carries every answer, all on one layer ---------------------
// No gesture hides 同意/不同意 behind another button any more: picking the
// faint word lands directly on the card that can answer it.
await select(6, 12)
const cardState = await page.evaluate(() => {
  const box = document.querySelector('[data-select-consent-popup]')
  if (box === null) return null
  const field = box.querySelector('[data-select-consent-note]')
  return {
    // `data-answer` carries the label independently of the emoji beside it, and
    // of whether this harness bound a locale dictionary.
    answers: [...box.querySelectorAll('button[data-answer]')].map((button) =>
      button.getAttribute('data-answer')
    ),
    buttons: [...box.querySelectorAll('button')].map((button) => button.textContent),
    hasField: field !== null,
    focused: document.activeElement === field,
    highlighted: window.CSS.highlights.has('dsh-select-consent-preview'),
  }
})
check(cardState !== null, 'selecting text must open the card in one gesture')

// The card must arrive, not appear: an entrance that fades and rises a few
// pixels reads as the card following the selection, where a hard cut reads as a
// repaint.
const entrance = await page.evaluate(() => {
  const box = document.querySelector('[data-select-consent-popup]')
  const style = getComputedStyle(box)
  return {
    armed: box.getAttribute('data-enter'),
    name: style.animationName,
    duration: style.animationDuration,
    running: typeof box.getAnimations === 'function' ? box.getAnimations().length : -1,
  }
})
check(
  entrance.armed === 'true',
  'a newly opened card must be armed for its entrance animation'
)
check(
  entrance.name === 'dsh-select-consent-in',
  `the card must animate in, got animation-name ${entrance.name}`
)
check(
  parseFloat(entrance.duration) > 0 && parseFloat(entrance.duration) <= 0.25,
  `the entrance must be quick enough to feel immediate, got ${entrance.duration}`
)

// Typing must not replay it. The scene object is replaced on every keystroke,
// so an animation keyed on it would restart while the reader types — the
// opposite of smooth.
await page.evaluate(() => {
  const box = document.querySelector('[data-select-consent-popup]')
  window.__enters = 0
  const seen = new MutationObserver((records) => {
    for (const record of records) {
      if (record.attributeName === 'data-enter' && box.getAttribute('data-enter') === 'true') {
        window.__enters += 1
      }
    }
  })
  seen.observe(box, { attributes: true, attributeFilter: ['data-enter'] })
  window.__enterObserver = seen
})
await page.keyboard.type('abcdef')
await page.waitForTimeout(300)
const restarted = await page.evaluate(() => {
  window.__enterObserver.disconnect()
  return window.__enters
})
check(
  restarted === 0,
  `typing must not restart the entrance animation, saw ${restarted} restart(s)`
)
check(
  cardState.answers.join(',') === 'agree,disagree',
  `the card must offer 同意 first, then 不同意 — got ${cardState.answers.join(',')}`
)
check(cardState.hasField, 'the custom input must live on the first layer')
check(cardState.focused, 'the input must take the caret as soon as the card opens')
check(cardState.highlighted, 'the selected passage must be highlighted while the card is open')

// --- 1b. the count must pulse when it grows --------------------------------
// The stylesheet alone proves nothing: this watches the attribute that arms the
// animation, while the count is still climbing.
await page.evaluate(() => {
  window.__pulses = []
  const watch = () => {
    const button = document.querySelector('[data-select-consent-insert]')
    if (button !== null && button.getAttribute('data-pulse') === 'true') {
      window.__pulses.push(button.getAttribute('data-count'))
    }
  }
  window.__pulseTimer = setInterval(watch, 16)
})
// A non-empty note commits a quoted pick and grows the count.
await select(0, 5)
await page.keyboard.type('赞同')
await page.keyboard.press('Enter')
// Longer than the animation: this section is checking that it *ends*.
await page.waitForTimeout(900)
const pulses = await page.evaluate(() => {
  clearInterval(window.__pulseTimer)
  const button = document.querySelector('[data-select-consent-insert]')
  const span = button.querySelector('.dsh-select-consent-count')
  return {
    seen: window.__pulses,
    atRest: button.getAttribute('data-pulse'),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationName: getComputedStyle(span).animationName,
    animations: span.getAnimations ? span.getAnimations().length : 'n/a',
  }
})

check(
  pulses.seen.length > 0,
  `the count must pulse when a pick is added, saw ${JSON.stringify(pulses.seen)}`
)
check(
  pulses.atRest === null,
  `the pulse must clear itself so the next pick can pulse again, got ${pulses.atRest}`
)

// The pulse section picked a passage of its own to move the number. It is not
// part of what follows, so the set is emptied before the real flow begins —
// otherwise the assertions below would be reading this section's leftovers.
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})

// --- 2. the card keeps the caret and tells the composer ---------------------
// A fresh selection: the pulse section above answered a card of its own.
await select(6, 12)
await page.waitForTimeout(300)
check(await boxOpen(), 'the card must stay open while it is being answered')
check(
  await page.evaluate(() => document.activeElement === document.querySelector('[data-select-consent-note]')),
  'the caret must land in the field without a second click'
)
check(
  (await page.evaluate(() => document.querySelector('.dsh-composer-anchor').getAttribute('aria-expanded'))) ===
    'true',
  'the composer must be told a dropdown owns the keyboard while the card is open'
)

// --- 2b. two emoji answers above the field -----------------------------------
// The card contains 「不同意」「同意」「标记」 and the input: no helper copy beyond
// the field's own placeholder.
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})
await select(6, 12)
await page.waitForTimeout(300)
const quickRow = await page.evaluate(() => {
  const box = document.querySelector('[data-select-consent-popup]')
  const buttons = [...box.querySelectorAll('button')].map((button) => button.textContent)
  const answers = [...box.querySelectorAll('button[data-answer]')].map((button) =>
    button.getAttribute('data-answer')
  )
  const field = box.querySelector('[data-select-consent-note]')
  const firstButton = box.querySelector('button')
  const agree = box.querySelector('[data-answer="agree"]')
  const disagree = box.querySelector('[data-answer="disagree"]')
  return {
    buttons,
    answers,
    placeholder: field && field.getAttribute('placeholder'),
    width: box.getBoundingClientRect().width,
    agreeClass: agree === null ? '' : agree.className,
    disagreeClass: disagree === null ? '' : disagree.className,
    // Above, not merely present: a control that sat under the field would be
    // read as a footnote to it.
    above: (() => {
      if (firstButton === null || field === null) return false
      const fieldTop = field.getBoundingClientRect().top
      return [...box.querySelectorAll('button')].every(
        (button) => button.getBoundingClientRect().bottom <= fieldTop
      )
    })(),
    focused: document.activeElement === field,
    compact: box.getBoundingClientRect().width <= 330,
  }
})
check(
  quickRow.answers.join(',') === 'agree,disagree',
  `the card must offer 同意 first, then 不同意, got ${quickRow.answers.join(',')}`
)
check(quickRow.above, 'the answers must sit above the input field')
check(quickRow.focused, 'the field must take the caret with the answers present')
check(quickRow.compact, `the card must stay compact, got ${quickRow.width}px`)
// The harness hands the card a `t` that returns keys, so the placeholder is the
// key here. What matters is that one exists at all — a bare field with no
// guidance is the thing this guards against.
check(
  quickRow.placeholder === 'notePlaceholder',
  `the custom input must carry a placeholder, got ${JSON.stringify(quickRow.placeholder)}`
)
check(
  quickRow.disagreeClass.endsWith('--disagree') && quickRow.agreeClass.endsWith('--agree'),
  'the agree and disagree buttons must have distinct visual treatments'
)

await clickAnswer('agree')
await page.waitForTimeout(300)
check(!(await boxOpen()), 'a quick answer must close the card in one click')
check(
  JSON.stringify(await marks()) === JSON.stringify([{ quote: 'world!', note: 'agree' }]),
  `the agree button must store 同意 as the note, got ${JSON.stringify(await marks())}`
)
check(
  await page.evaluate(() => window.__dshSelectConsent.quotedOf(window.__dshSelectConsent.marks('s1')[0])),
  'a quick answer must mark its pick as one to quote'
)

// The other answer, on a second passage.
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})
await select(13, 19)
await page.waitForTimeout(300)
await clickAnswer('disagree')
await page.waitForTimeout(300)
check(
  JSON.stringify(await marks()) === JSON.stringify([{ quote: 'Second', note: 'disagree' }]),
  `the disagree button must store 不同意 as the note, got ${JSON.stringify(await marks())}`
)
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'a quick answer must not touch the composer either'
)
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})

// --- 2c. a typed sentence survives a quick answer ---------------------------
// The reader may start with their own words and then decide the shortcut is
// enough. The click records the answer *and* the sentence, in the order they
// said them: 同意 on its own line, then the reader's words.
await select(6, 12)
await page.waitForTimeout(250)
await page.keyboard.type('但第三步也可以先量一下')
await page.waitForTimeout(120)
await clickAnswer('agree')
await page.waitForTimeout(300)
check(!(await boxOpen()), 'a quick answer with typed text must still close the card')
check(
  JSON.stringify(await marks()) ===
    JSON.stringify([{ quote: 'world!', note: 'agree\n但第三步也可以先量一下' }]),
  `a quick answer must keep the typed sentence under 同意, got ${JSON.stringify(await marks())}`
)

await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})

// Saying it twice is not a second sentence: when the typed text already opens
// with the answer, the text stands on its own.
await select(6, 12)
await page.waitForTimeout(250)
await page.keyboard.type('agree，但只限读多写少')
await page.waitForTimeout(120)
await clickAnswer('agree')
await page.waitForTimeout(300)
check(
  JSON.stringify(await marks()) ===
    JSON.stringify([{ quote: 'world!', note: 'agree，但只限读多写少' }]),
  `a typed sentence that already opens with 同意 must not repeat it, got ${JSON.stringify(await marks())}`
)
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})

// --- 3. Enter stores the note, and only the note ----------------------------
await select(6, 12)
await page.waitForTimeout(300)
await page.keyboard.type('这句我认同')
await page.waitForTimeout(150)
check(
  (await page.evaluate(() => document.querySelector('[data-select-consent-note]').value)) === '这句我认同',
  'the box must hold what was typed'
)
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check(!(await boxOpen()), 'Enter must close the box')
check(
  JSON.stringify(await marks()) === JSON.stringify([{ quote: 'world!', note: '这句我认同' }]),
  `Enter must store exactly the note, got ${JSON.stringify(await marks())}`
)
check(
  await page.evaluate(() => window.__dshSelectConsent.quotedOf(window.__dshSelectConsent.marks('s1')[0])),
  'a note must mark its pick as one to quote'
)
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'the composer must still be untouched: nothing is handed over until 汇总'
)
check(
  await page.evaluate(() => {
    const api = window.__dshSelectConsent
    const mark = api.marks('s1')[0]
    return mark !== undefined && mark.replyKey === api.currentReplyKey()
  }),
  'a pick must remember which reply it belongs to'
)

// --- 4. the insert button appears, and says what it will do -----------------
const insertShown = await page.evaluate(() => {
  const button = document.querySelector('[data-select-consent-insert]')
  return button === null ? null : { label: button.getAttribute('aria-label') }
})
check(insertShown !== null, 'a pending pick must draw the insert button')
check(
  insertShown.label === 'insertPicks',
  `the button must name what it inserts, got ${insertShown.label}`
)
// The composer area itself must stay empty: no counters, no pin row.
const composerClutter = await page.evaluate(
  () =>
    document.querySelector('[data-select-consent-pins]') !== null ||
    document.querySelector('[data-select-consent-dock]') !== null
)
check(!composerClutter, 'nothing but the button may be drawn in the composer')

// --- 10. the button measures like the composer's other tools ----------------
// The styling is copied from `dsh-genui`'s prompt toggle, which is a 28px ghost
// pill. If the box drifts, the tool row stops lining up — so it is measured
// rather than only asserted on the style object.
const box = await page.evaluate(() => {
  const button = document.querySelector('[data-select-consent-insert]')
  if (button === null) return null
  const rect = button.getBoundingClientRect()
  return {
    width: rect.width,
    height: rect.height,
    count: button.getAttribute('data-count'),
    ready: button.getAttribute('data-ready'),
    text: button.textContent,
    borderWidth: getComputedStyle(button).borderTopWidth,
    borderStyle: getComputedStyle(button).borderTopStyle,
    borderColor: getComputedStyle(button).borderTopColor,
    radius: getComputedStyle(button).borderRadius,
  }
})
check(box !== null, 'the button must be on screen')
// Height matches the tool row; width is the content's, because the button also
// carries the count.
check(
  box.height === 28,
  `the button must lay out 28 tall like the tool row's other button, got ${box.height}`
)
check(box.width >= 28, `the button must never be narrower than its neighbour, got ${box.width}`)
check(box.count === '1', `the button must show the pending count, got ${box.count}`)
// Measured, not read off the style object: a button with no border still
// reports a width of 0px, and that is the case this has to catch.
check(
  parseFloat(box.borderWidth) > 0,
  `the button must carry an edge so its number reads as a control, got border-width ${box.borderWidth}`
)
check(
  box.borderStyle === 'solid',
  `the edge must be a real border, got border-style ${box.borderStyle}`
)
check(
  box.borderColor !== 'rgba(0, 0, 0, 0)',
  `the edge must be visible, got ${box.borderColor}`
)
check(box.ready === 'true', 'the button must be enabled while something is pending')
check(
  box.text === 'insertVerb1',
  `the button must read as "verb + 1" when one pick is waiting, got ${JSON.stringify(box.text)}`
)


// --- 5. the button hands the set over, as a quote + a note -------------------
await page.evaluate(() => document.querySelector('[data-select-consent-insert]').click())
await page.waitForTimeout(300)
check(
  JSON.stringify(await page.evaluate(() => window.__inserted)) ===
    JSON.stringify(['> world!\n我的回答：这句我认同\n\n']),
  `the button must insert the quote, a blank line, then the note; got ${JSON.stringify(
    await page.evaluate(() => window.__inserted)
  )}`
)
const afterInsert = await page.evaluate(() => {
  const button = document.querySelector('[data-select-consent-insert]')
  return button === null
    ? null
    : {
        ready: button.getAttribute('data-ready'),
        count: button.getAttribute('data-count'),
        text: button.textContent,
      }
})
check(afterInsert !== null, 'the button stays resident after the insert, so it is learnable')
check(
  afterInsert.ready === 'false',
  `the button must go idle once nothing is pending, got ${JSON.stringify(afterInsert)}`
)
check(
  afterInsert.text === 'insertVerb1',
  `the label must keep its shape after the insert, got ${JSON.stringify(afterInsert.text)}`
)

// --- 6. Escape leaves without storing ---------------------------------------
await select(13, 19)
await page.waitForTimeout(250)
await page.keyboard.type('不要这句')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check(!(await boxOpen()), 'Escape must close the card')
const afterEscape = await marks()
check(
  afterEscape.length === 1,
  `Escape must not add a mark, got ${JSON.stringify(afterEscape)}`
)

// --- 7. clicking away keeps what was typed, and drops an empty card ----------
await select(13, 19)
await page.waitForTimeout(250)
await page.keyboard.type('这段要留')
await clickOutside()
await page.waitForTimeout(300)
check(
  (await marks()).some((mark) => mark.note === '这段要留'),
  'clicking away from a card with words in it must keep them'
)

await select(0, 5)
await page.waitForTimeout(250)
await clickOutside()
await page.waitForTimeout(300)
const afterEmpty = await marks()
check(
  afterEmpty.filter((mark) => mark.quote === 'Hello').length === 0,
  'an empty card closed from outside must store nothing'
)

// --- 8. a bare pick is counted, and is not handed over ----------------------
// 「标记」 is the card's only answer without a stored response: a pick with no
// note at all, which must never reach the composer.
await select(0, 5)
await page.waitForTimeout(250)
await clickAnswer('mark')
await page.waitForTimeout(300)
check(
  (await marks()).some((mark) => mark.quote === 'Hello' && mark.note === ''),
  '标记 must store a pick with no note'
)
await page.evaluate(() => { window.__inserted.length = 0 })
await page.evaluate(() => document.querySelector('[data-select-consent-insert]').click())
await page.waitForTimeout(300)
const handed = await page.evaluate(() => window.__inserted.join(''))
check(
  !handed.includes('Hello'),
  `a bare pick must never be handed to the composer, got ${JSON.stringify(handed)}`
)
check(
  handed.includes('这段要留'),
  `the annotated pick beside it must still be handed over, got ${JSON.stringify(handed)}`
)

// --- 9. an empty note cancels the preview and leaves no mark -----------------
// A clean set: earlier steps left marks on these same passages, and this section
// is about what an empty commit does, not about what was already there.
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})
await page.evaluate(() => { window.__inserted.length = 0 })
await select(13, 19)
await page.waitForTimeout(250)
const previewWhileOpen = await page.evaluate(() => {
  const registry = window.CSS && window.CSS.highlights
  return registry && registry.has('dsh-select-consent-preview')
})
check(previewWhileOpen, 'the card must highlight the selected passage as soon as it opens')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check(!(await boxOpen()), 'committing an empty note closes the card')
check(
  !(await page.evaluate(() => window.CSS.highlights.has('dsh-select-consent-preview'))),
  'an empty note must remove the temporary highlight'
)
check(
  !(await marks()).some((mark) => mark.quote === 'Second'),
  'an empty note must not create a durable mark'
)
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'an empty note must not put anything in the composer'
)

// --- 10b. a pick from an earlier reply never reaches this draft --------------
// The UI refuses to make such a pick now, but a pick may already be in storage
// from before the reply changed, or from an older version. Delivery is scoped
// again, so the old note cannot ride along under the newest message.
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
  api.addMark('s1', {
    key: 'k0',
    quote: 'Earlieranswer',
    prefix: '',
    suffix: '',
    index: 0,
    text: 'Earlier answer',
    note: '上一轮的看法',
    quoted: true,
  })
})
const oldPick = await page.evaluate(() => {
  const api = window.__dshSelectConsent
  const all = api.marks('s1')
  return {
    total: all.length,
    scoped: api.scopedOf(all, 's1').length,
    current: api.currentReplyKey(),
    saved: all[0] === undefined ? null : all[0].replyKey,
  }
})
check(oldPick.total === 1, 'the old pick must be in storage for this check to mean anything')
check(oldPick.current === 'step:2', `the newest reply must be step:2, got ${oldPick.current}`)
check(oldPick.saved !== oldPick.current, 'the old pick must not claim the newest reply')
check(
  oldPick.scoped === 0,
  `a pick from an earlier reply must not be handed to this draft, got ${oldPick.scoped} in scope`
)
await page.evaluate(() => {
  const api = window.__dshSelectConsent
  for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
})

// --- 11. auto-insert on arriving at the composer ----------------------------
// The set is handed over at the moment the reader arrives to answer, so there is
// no separate "when do I press it" decision to make.
const reset = () =>
  page.evaluate(() => {
    const api = window.__dshSelectConsent
    for (const mark of api.marks('s1')) api.removeMark('s1', mark.id)
    window.__inserted.length = 0
    window.__dshSelectConsent.bridge.draft = ''
  })

const focusComposer = () =>
  page.evaluate(() => {
    document.querySelector('[data-lexical-editor="true"]').focus()
  })

const autoState = () =>
  page.evaluate(() => {
    const button = document.querySelector('[data-select-consent-auto]')
    return button === null ? null : button.getAttribute('data-select-consent-auto')
  })

// Auto is the default, and the switch must say so on screen.
check((await autoState()) === 'on', `auto must default to on, got ${await autoState()}`)

await reset()
await select(6, 12)
await clickAnswer('agree')
await page.waitForTimeout(300)
check((await marks()).length === 1, 'the pick must be recorded before the composer is entered')
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'nothing may reach the composer until the reader arrives there'
)

// The insert runs one task after `focusin`, not inside it: the pointer's own
// caret placement happens after the focus event, so inserting synchronously
// would put the text in and then leave the caret back at the start of the box.
const timing = await page.evaluate(async () => {
  window.__inserted.length = 0
  document.querySelector('[data-lexical-editor="true"]').focus()
  const immediately = window.__inserted.length
  await new Promise((resolve) => setTimeout(resolve, 80))
  return { immediately, later: window.__inserted.length }
})
check(
  timing.immediately === 0,
  'the automatic insert must not run inside focusin: the click has not placed its caret yet'
)
check(timing.later === 1, 'the automatic insert must follow on the next task')
check(
  (await page.evaluate(() => window.__inserted[0])).endsWith('\n\n'),
  `the inserted block must end with a blank line so typing starts on a new line, got ${JSON.stringify(
    await page.evaluate(() => window.__inserted[0])
  )}`
)
check(
  (await page.evaluate(() => window.__dshSelectConsent.pending(window.__dshSelectConsent.marks('s1'))))
    .length === 0,
  'an inserted set must stop being pending'
)
await focusComposer()
await page.waitForTimeout(200)
check(
  (await page.evaluate(() => window.__inserted.length)) === 1,
  'a second visit to the composer must not insert the same set twice'
)

// --- 12. manual mode: announce, do not insert -------------------------------
await page.evaluate(() => {
  document.activeElement.blur()
})
await page.evaluate(() => document.querySelector('[data-select-consent-auto]').click())
await page.waitForTimeout(150)
check((await autoState()) === 'off', 'the switch must turn auto off, visibly')

await reset()
await select(6, 12)
await clickAnswer('agree')
await page.waitForTimeout(250)
await focusComposer()
await page.waitForTimeout(250)
check(
  (await page.evaluate(() => window.__inserted.length)) === 0,
  'with auto off the composer must be left alone'
)
const hint = await page.evaluate(() => {
  const node = document.querySelector('[data-select-consent-hint]')
  return node === null ? null : { text: node.textContent, role: node.getAttribute('role') }
})
check(hint !== null, 'with auto off, a pending set must announce itself on arrival')
check(hint.role === 'status', 'the notice must be announced as a status')
check(
  (await page.evaluate(
    () => document.querySelector('[data-select-consent-insert]').getAttribute('data-pulse')
  )) === 'true',
  'the notice must draw the eye to the button it is about'
)

// The same batch is read out once, not on every trip through the composer.
// The notice is left to retire on its own timer: removing a portal's node by
// hand makes React's own cleanup fail, which would take the whole tool row with
// it — a test artefact, but one that hides the behaviour being tested.
await page.evaluate(() => {
  document.activeElement.blur()
})
await page.waitForTimeout(2600)
await focusComposer()
await page.waitForTimeout(250)
check(
  (await page.evaluate(() => document.querySelector('[data-select-consent-hint]'))) === null,
  'the same batch must not be announced twice'
)

// A new pick is news, so it arms the notice again.
await page.evaluate(() => document.activeElement.blur())
await select(13, 19)
await clickAnswer('agree')
await page.waitForTimeout(250)
await focusComposer()
await page.waitForTimeout(250)
check(
  (await page.evaluate(() => document.querySelector('[data-select-consent-hint]'))) !== null,
  'a new pick must re-arm the notice'
)

// --- 13. turning it back on inserts again -----------------------------------
await page.evaluate(() => document.activeElement.blur())
await page.evaluate(() => document.querySelector('[data-select-consent-auto]').click())
await page.waitForTimeout(150)
check((await autoState()) === 'on', 'the switch must turn auto back on')
await page.evaluate(() => { window.__inserted.length = 0 })
await focusComposer()
await page.waitForTimeout(300)
check(
  (await page.evaluate(() => window.__inserted.length)) === 1,
  'with auto back on, arriving at the composer must insert again'
)

// --- 14. 「取消标记」 takes the block back out of the composer --------------
// A mark owns one block inside the draft. Taking the mark back has to take that
// block with it — otherwise the composer keeps words the reader has revoked,
// and the next message says them anyway.
//
// The harness has no Lexical editor, so `input.draft` is parked by hand after
// each insert, exactly as the real bridge would republish it.
await reset()
await page.evaluate(() => { window.__inserted.length = 0; window.__setDraft.length = 0 })
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(80)
await select(0, 5)
await clickAnswer('agree')
await page.waitForTimeout(250)
await focusComposer()
await page.waitForTimeout(250)
const handedOnce = await page.evaluate(() => window.__inserted.join(''))
check(handedOnce.length > 0, 'the pick must be in the draft before a withdrawal can be tested')
await page.evaluate((text) => { window.__dshSelectConsent.bridge.draft = text }, handedOnce)

/** The viewport point on the first marked passage; a click there opens its card. */
const markedPoint = await page.evaluate(() => {
  const node = document.getElementById('p1').firstChild
  const range = document.createRange()
  range.setStart(node, 0)
  range.setEnd(node, 5)
  const box = range.getBoundingClientRect()
  return { x: box.left + 2, y: box.top + box.height / 2 }
})

const openMarkCard = async () => {
  await page.mouse.click(markedPoint.x, markedPoint.y)
  await page.waitForSelector('[data-select-consent-popup]', { timeout: 2000 })
  await page.waitForTimeout(80)
}

/** What the compact card currently holds, and the unmark button's label. */
const readMarkCard = () =>
  page.evaluate(() => {
    const card = document.querySelector('[data-select-consent-popup]')
    if (card === null) return null
    const buttons = [...card.querySelectorAll('button')].map((button) => button.textContent)
    return { text: card.textContent, buttons: buttons }
  })

await openMarkCard()
const markedCard = await readMarkCard()
check(
  markedCard !== null && markedCard.buttons[0] === 'unmark',
  `a marked passage must offer 「取消标记」, got ${JSON.stringify(markedCard)}`
)

await page.evaluate(() => {
  document.querySelector('[data-select-consent-popup] button').click()
})
await page.waitForTimeout(200)
const withdrawn = await page.evaluate(() => {
  const card = document.querySelector('[data-select-consent-popup]')
  return {
    drafts: window.__setDraft.slice(),
    quotes: window.__dshSelectConsent.marks('s1').map((mark) => mark.quote),
    buttons: card === null ? [] : [...card.querySelectorAll('button')].map((b) => b.textContent),
    text: card === null ? null : card.textContent,
    draft: window.__dshSelectConsent.bridge.draft,
  }
})
check(
  withdrawn.drafts.length === 1 && withdrawn.drafts[0] === '',
  `unmarking must remove the block from the draft, got ${JSON.stringify(withdrawn.drafts)}`
)
check(
  !withdrawn.quotes.includes('Hello'),
  'unmarking must forget the mark itself'
)
check(
  withdrawn.draft === '',
  'the parked draft must be advanced so nothing in this tick still sees the block'
)
check(
  withdrawn.buttons.includes('undo'),
  'a removal must offer 「撤销」 while the draft still holds what the removal wrote'
)
check(
  withdrawn.text !== null && withdrawn.text.includes('unmarkRemoved'),
  `the card must say the block was removed, got ${JSON.stringify(withdrawn.text)}`
)

// Undo puts both halves back: the words in the draft and the mark on the page.
await page.evaluate(() => {
  const card = document.querySelector('[data-select-consent-popup]')
  ;[...card.querySelectorAll('button')]
    .find((button) => button.textContent === 'undo')
    .click()
})
await page.waitForTimeout(200)
const restored = await page.evaluate(() => ({
  drafts: window.__setDraft.slice(),
  quotes: window.__dshSelectConsent.marks('s1').map((mark) => mark.quote),
  draft: window.__dshSelectConsent.bridge.draft,
  card: document.querySelector('[data-select-consent-popup]') !== null,
}))
check(
  restored.drafts.length === 2 && restored.drafts[1] === handedOnce,
  `undo must put the exact block back, got ${JSON.stringify(restored.drafts)}`
)
check(
  restored.draft === handedOnce,
  'undo must advance the parked draft back to what it was'
)
check(
  restored.quotes.includes('Hello'),
  'undo must put the mark back on the passage'
)
check(!restored.card, 'undo must close the report card')

// A draft the reader has edited inside the block is never guessed at: the
// block is no longer there verbatim, so the mark goes and the words stay.
// A double-click away from the last one, so this is two clicks and not one.
await page.waitForTimeout(650)
await page.evaluate((text) => {
  window.__dshSelectConsent.bridge.draft = text.replace('Hello', 'Helo')
  window.__setDraft.length = 0
}, handedOnce)
await openMarkCard()
await page.evaluate(() => {
  document.querySelector('[data-select-consent-popup] button').click()
})
await page.waitForTimeout(200)
const edited = await page.evaluate(() => {
  const card = document.querySelector('[data-select-consent-popup]')
  return {
    drafts: window.__setDraft.slice(),
    quotes: window.__dshSelectConsent.marks('s1').map((mark) => mark.quote),
    buttons: card === null ? [] : [...card.querySelectorAll('button')].map((b) => b.textContent),
    text: card === null ? null : card.textContent,
  }
})
check(
  edited.drafts.length === 0,
  `an edited block must not be rewritten, got ${JSON.stringify(edited.drafts)}`
)
check(
  !edited.quotes.includes('Hello'),
  'the mark must still be removed when the draft cannot be rewritten'
)
check(
  edited.buttons.length === 0,
  'no undo may be offered when nothing was removed'
)
check(
  edited.text !== null && edited.text.includes('unmarkEdited'),
  `the card must say why the draft was left alone, got ${JSON.stringify(edited.text)}`
)

// A draft the reader had already started: the block is appended below it with
// a newline, and taking the block back must take that newline too — leaving the
// draft exactly as it was, so the next automatic insert still sees it as free.
await page.waitForTimeout(650)
await reset()
await page.evaluate(() => {
  window.__inserted.length = 0
  window.__setDraft.length = 0
  window.__dshSelectConsent.bridge.draft = '已经写好的话'
})
await page.evaluate(() => window.scrollTo(0, 0))
await select(0, 5)
await clickAnswer('agree')
await page.waitForTimeout(200)
await page.evaluate(() => document.querySelector('[data-select-consent-insert]').click())
await page.waitForTimeout(250)
const appended = await page.evaluate(() => window.__inserted.join(''))
check(
  appended.startsWith('\n'),
  `a block appended under a draft must open on a new line, got ${JSON.stringify(appended)}`
)
await page.evaluate((text) => {
  window.__dshSelectConsent.bridge.draft = '已经写好的话' + text
}, appended)
await openMarkCard()
await page.evaluate(() => {
  document.querySelector('[data-select-consent-popup] button').click()
})
await page.waitForTimeout(200)
const trimmed = await page.evaluate(() => window.__setDraft.slice())
check(
  trimmed.length === 1 && trimmed[0] === '已经写好的话',
  `removing the only block must also remove the newline it added, got ${JSON.stringify(trimmed)}`
)
console.log('   unmark: removed, undoed, and refused to touch an edited draft')

check(pageErrors.length === 0, `the page reported errors:\n${pageErrors.join('\n')}`)

await browser.close()
console.log(
  'OK: the button — on the mouse-up, no focus, no paint — the card, and the hover that takes the caret — ' +
    'and the card: one-layer answers, caret, Enter, Escape, click-away, insert button'
)
