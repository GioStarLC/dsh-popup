/**
 * dsh-select-consent — pick passages out of the transcript, and turn the
 * picked set into your reply whenever you want.
 *
 * ## The model: picking and annotating is what you do; the composer is one exit
 *
 * Reading five possible approaches and answering them is not one motion. It has
 * a middle: you pick a passage, you say what you think about it, and you go on
 * reading. So the composer is NOT where the answer is written — it is where the
 * collected set is finally *handed over*, and nothing is written into it until
 * that exit is taken.
 *
 *   select text in the newest assistant reply  ->  a small popup appears above
 *                                        the selection
 *
 * The scope is one reply, not the transcript. The composer is answering the
 * newest assistant message, so a passage from an earlier turn is still reading
 * material — it can be selected and copied — but it cannot join this draft. The
 * scope is checked when the button is drawn and again when picks are handed
 * over, because a reply that arrives after a pick moves that pick out of scope.
 *
 *   「标记」           pick the passage and nothing else. No box: a pick with
 *                      no note is still a complete pick, and it stays that way
 *                      in the set. Offered only where a mark can be anchored.
 *
 *   「引用并附注」     pick it and open the note box *in place*: the popup
 *                      becomes a focused textarea, so the next keystroke is
 *                      your note and the composer is never touched. Enter
 *                      commits, Shift+Enter breaks the line, Escape cancels.
 *                      A note is stored only when something was typed — an
 *                      empty box is 「标记」, not a note that says nothing.
 *
 *   「同意」/「不同意」  answer in one click. If the box already holds a sentence,
 *                      the click does not throw it away: the answer becomes the
 *                      first line and the sentence follows, one note in the
 *                      order the reader said it.
 *
 *   composer pin row   the notes you have made hang above the composer, where
 *                      they read as the thing being written *to*. It is the
 *                      live half of a quote: you see the passage you agreed
 *                      with while you write about it, instead of seeing only
 *                      the assembled result at the very end.
 *
 *   composer dock      a line under the composer — 「已标记 3 项 · 汇总 2 项进
 *                      输入框」 — appears whenever the Session has marks. It is
 *                      the exit for a set collected over several picks, and it
 *                      is the only thing that makes "pick five, use three"
 *                      expressible at all. Only annotated picks are handed
 *                      over: a bare mark says what you chose, not what you say.
 *
 *   click a marked passage  ->  the popup returns, offering 「取消标记」 — which
 *                      discards the note with it, and says so in its title
 *                      rather than dropping the note quietly. If the pick had
 *                      already been handed to the composer, its block is taken
 *                      back out of the draft too, when the block is still there
 *                      verbatim; the card then says whether it was removed, and
 *                      offers 「撤销」 while the draft still holds exactly what
 *                      the removal wrote. A draft that was edited, or that
 *                      carries a reference chip, is left alone and the card
 *                      says so — see `withdrawComposerBlock`.
 *
 * Built to the DSH client-module contract: a single file that registers a
 * factory with `window.__ModuleLoader__`. The factory IS the module — it must
 * return the package's Client exports (a `module.exports` here is a
 * ReferenceError, and a Client entry that fails to activate blocks the whole
 * web boot). Run `node tools/check-client-bundle.mjs` after every edit.
 *
 * Three seats are used, because no one of them is enough:
 *
 *   `shell.overlay`              renders the popup and the mark CSS. It is the
 *                                frame-wide floating layer, so the popup is
 *                                positioned against the viewport and no scroll
 *                                container or transformed ancestor can clip it.
 *   `conversation.input.dock`    renders the pin row above the composer, and
 *                                nothing else. It is the seat where the shell
 *                                hands out the Session's own input face
 *                                (`input` + `inputActions`), which the popup
 *                                borrows to append to the draft through the
 *                                shipped API instead of poking at the editor's
 *                                DOM. It is also the seat whose own props carry
 *                                the Session id, which is what the pin row names
 *                                its marks by.
 *   (the transcript itself)      is never touched. Marks are painted with the
 *                                CSS Custom Highlight API over Ranges derived
 *                                from stored anchors, so the Conversation's own
 *                                React tree stays the only thing that renders
 *                                the transcript.
 *
 * The pin row renders into `conversation.input.dock` and not into
 * `conversation.composer.dock`, even though it draws above the composer: the
 * dock is rendered above `conversation.composer.bar` (the InputBar), so a pin
 * placed there would sit *below* the input bar rather than above it. The dock
 * is also the seat that carries the input face, and a pin row has to be able
 * to name its Session's marks, so it is the only seat where both the geometry
 * and the data line up.
 *
 * ## Why an append needs no caret switch
 *
 * The composer's editor is a Lexical tree the shell owns; moving its caret
 * directly is exactly the DOM poking this plugin refuses to do. The shipped
 * `InputActions` face is enough: `captureInsertion()` returns the draft
 * selection with the revision it belongs to, and trading that revision back to
 * `insertText(text, span)` inserts one undoable edit at that point. The caret
 * therefore does not move, the user's own typing is not disturbed, and after
 * 「引用并附注」 no key has been stolen from the box they are typing in.
 *
 * The one DOM-level condition the append does carry: `setDraft` /
 * `insertText` leave the editor's selection at the end and focusing is what
 * turns that into a live caret, so a write to the composer while the note box
 * has the keyboard makes the *next* keystroke land in the composer, at the
 * end, instead of in the box. The reader therefore types notes first and the
 * aggregate exit writes once, rather than each note appending to a draft that
 * another window is typing into.
 *
 * ## Why marks are stored as anchors, not as DOM ranges
 *
 * The transcript is virtualized and incrementally assembled: nodes outside the
 * viewport are unmounted, older turns are materialized on demand, and a
 * streaming message re-renders continuously. A saved `Range` therefore cannot
 * be the mark. A mark stores:
 *
 *   key     the `data-chat-anchor-key` of the nearest enclosing flow item —
 *           derived from `stepKey(turn, step)`, so it survives a reload,
 *           a restart, paging, and a switch back to the session.
 *   quote   the selected text, whitespace dropped.
 *   prefix  ~24 kept characters before the quote, same projection.
 *   suffix  ~24 kept characters after it.
 *   index   the kept-character offset inside the anchor, as a drift hint.
 *
 * Re-deriving walks the anchor's visible text with the same projection, finds
 * `quote`, and scores every occurrence on prefix, suffix and distance from
 * `index`. Whitespace is dropped on both sides because the browser inserts
 * block separators into `selection.toString()` that no DOM walk reproduces.
 */
window.__ModuleLoader__.load({
  // Must equal the package name: dsh-client-modules keys every graph row by the
  // resolved manifest's package name, so a stale id leaves the `dsh-popup` row
  // unsatisfied and fails the whole web boot.
  id: 'dsh-popup',
  factory: function (require) {
    'use strict'

    var React = require('react')
    // The insert button's hover bubble is portalled to `document.body`, because
    // the composer's tool row is a clipped, transformed box.
    var ReactDOM = require('react-dom')

    /** Locale namespace owned by this plugin. */
    var NS = 'dsh-select-consent'

    /**
     * The composer in this host: the root of the rich-text editor. Lexical
     * marks its own root, and no other package in the shell ships an editor,
     * so the marker names the composer exactly. It is a shortcut, never a
     * requirement — every path below survives `composerRoot()` returning null.
     */
    var COMPOSER_SELECTOR = '[data-lexical-editor="true"]'

    /** A field of its own: text selected there is being edited, not quoted. */
    var EDITABLE_SELECTOR =
      'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

    /** A modal owns the page while it is up; its selections are its own. */
    var MODAL_SELECTOR = '[role="dialog"], [role="alertdialog"]'

    /** The popup's own marker, so it never quotes itself and never self-hides. */
    var POPUP_MARKER = 'data-select-consent-popup'

    /** A flow item of the Conversation; the stable half of a mark's anchor. */
    var ANCHOR_SELECTOR = '[data-chat-anchor-key]'

    /** Registry names for committed marks and the note box's temporary preview. */
    var HIGHLIGHT_NAME = 'dsh-select-consent-mark'
    var PREVIEW_HIGHLIGHT_NAME = 'dsh-select-consent-preview'

    /** Where this plugin keeps its marks. */
    var MARKS_KEY = 'dsh-select-consent/marks/v1'

    /**
     * Whether entering an empty composer inserts the pending set by itself.
     *
     * A browser preference, not a per-Session one: it describes how the reader
     * works, and a reader does not change that between conversations.
     */
    var AUTO_KEY = 'dsh-select-consent/auto/v1'

    /**
     * What a note is prefixed with when the set is handed to the composer.
     *
     * This is wire format between the reader and the model, not UI copy: it goes
     * into the draft and then into the prompt, and it is the same string in every
     * locale because a prompt is not a place for a language setting. It exists to
     * stop the note being read as a lazy continuation of the quote above it.
     */
    var ANSWER_LABEL = '我的回答：'

    /** Bounds, so one session cannot fill storage. */
    var MAX_MARKS_PER_SESSION = 200
    var MAX_SESSIONS = 40
    var MAX_OCCURRENCES = 40
    var MAX_QUOTE_CHARS = 8000

    /**
     * How much of a selection is kept verbatim beside its anchor.
     *
     * The anchor itself only needs the whitespace-free `quote`, which locates
     * the passage; this is what the aggregate exit re-emits into the composer,
     * so it has to be the reader's own text, not the projection.
     */
    var MAX_TEXT_CHARS = 4000

    /** How much context a mark keeps on each side of the quote. */
    var CONTEXT_CHARS = 24

    // ---------------------------------------------------------------------
    // the consent gate
    // ---------------------------------------------------------------------

    /**
     * How long the pointer has to rest on the button before the card opens.
     *
     * Hover is a weaker signal than a click, so it costs time rather than a
     * confirmation: passing over the button is not a decision, stopping on it is.
     */
    var PEEK_HOVER_MS = 160

    /**
     * How long an untouched button stays on screen.
     *
     * The button is not a decision, so it must not need dismissing. Four seconds
     * is long enough to notice it, short enough that a forgotten one is gone
     * before it becomes furniture.
     */
    var PEEK_LIFE_MS = 4000

    /**
     * How long the unmark result stays on the card it happened on.
     *
     * A withdrawal writes to the draft, which the reader cannot see from the
     * transcript, so the card has to say what happened. It is also the only
     * place 「撤销」 can live: `setDraft` is a merged history entry, so the
     * composer's own undo cannot be relied on to put the block back. The window
     * is short on purpose — it is a correction, not a second decision.
     */
    var NOTICE_LIFE_MS = 3600
    var NOTICE_UNDO_MS = 6000

    // ---------------------------------------------------------------------
    // vocabulary
    // ---------------------------------------------------------------------

    var ZH = {
      mark: '标记',
      unmark: '取消标记',
      toolbarAnnotate: '给这段文字写一句',
      markedToolbar: '这段文字已被标记',
      markTitle: '只挑中这一段：留在页面上高亮，不写进输入框',
      notePlaceholder: '写下你的补充…',
      agree: '同意',
      disagree: '不同意',
      agreeEmoji: '👍',
      disagreeEmoji: '👎',
      unmarkTitle: '移除这条标记，连同它上面写的那句话；已经填入输入框的内容也会一并移除',
      unmarkRemoved: '已取消标记 · 已从输入框移除',
      unmarkEdited: '已取消标记 · 输入框里这段已被改动，未自动移除',
      unmarkLocked: '已取消标记 · 输入框暂不可改写，未自动移除',
      undo: '撤销',
      insertVerb: '填入',
      autoLabel: '自动',
      autoOn: '进入输入框时自动填入：开',
      autoOff: '进入输入框时自动填入：关（点「填入」手动交付）',
      manualHint: '有 {n} 条批注待填入',
      insertPicks: '{n} 条批注待填入输入框',
      insertPicksEmpty: '本轮还没有引用：选中这条回复里的文字，写下「同意」「不同意」或自己的补充',
      insertPicksDone: '{n} 条批注已填入输入框',
      peek: '批注',
      peekTitle: '为这段文字决定：标记，或写下你的回答',
    }

    var EN = {
      mark: 'Mark',
      unmark: 'Unmark',
      toolbarAnnotate: 'Answer this passage',
      markedToolbar: 'This passage is marked',
      markTitle: 'Pick this passage and keep it on the page only — never handed to the composer',
      notePlaceholder: 'Add your thought…',
      agree: 'Agree',
      disagree: 'Disagree',
      agreeEmoji: '👍',
      disagreeEmoji: '👎',
      unmarkTitle: 'Remove this mark and the note on it; what it already put in the composer goes too',
      unmarkRemoved: 'Unmarked · removed from the composer',
      unmarkEdited: 'Unmarked · the composer copy was edited, so it was left alone',
      unmarkLocked: 'Unmarked · the composer cannot be rewritten right now, so it was left alone',
      undo: 'Undo',
      insertVerb: 'Insert',
      autoLabel: 'Auto',
      autoOn: 'Insert into the composer on focus: on',
      autoOff: 'Insert into the composer on focus: off (use 「填入」)',
      manualHint: '{n} note(s) waiting to be inserted',
      insertPicks: '{n} note(s) waiting to be inserted',
      insertPicksEmpty: 'No quotes for this reply yet: select text in it, then answer with 同意, 不同意, or your own note',
      insertPicksDone: '{n} note(s) are already in the composer',
      peek: 'Note',
      peekTitle: 'Decide about this passage: mark it, or say what you think',
    }

    // ---------------------------------------------------------------------
    // the bridge to the Session's input face
    // ---------------------------------------------------------------------

    /**
     * What the popup needs from the Session it is answering. Written by
     * `ConsentBridge`, which is the only component mounted where the shell
     * hands these props out.
     */
    var shared = {
      /** The live draft text, or null when no composer is on screen. */
      draft: null,
      /** The shipped input action face, or null outside a Session. */
      actions: null,
      /** The Session the composer belongs to; marks are kept per Session. */
      sessionId: null,
      /**
       * How many reference chips the draft holds.
       *
       * A rewrite goes through `setDraft`, which rebuilds the editor from plain
       * text and therefore cannot carry a chip. Any chip at all makes the
       * rewrite lossy, so withdrawing a block is refused while one is present.
       */
      chips: 0,
      /** The composer's submission phase; only 'plain' may be rewritten. */
      phase: null,
    }

    /** Subscribers: anything that shows a mark count or paints a mark. */
    var watchers = []

    /**
     * The auto-insert preference, read once.
     *
     * Defaults to on: the point of the feature is that the reader never has to
     * remember to hand the set over. Off is the escape hatch for someone who
     * wants a clean draft first.
     */
    var autoPref = { value: null }

    function autoEnabled() {
      if (autoPref.value !== null) return autoPref.value
      var fallback = true
      try {
        var raw = window.localStorage.getItem(AUTO_KEY)
        autoPref.value = raw === null ? fallback : raw !== '0'
      } catch (error) {
        autoPref.value = fallback
      }
      return autoPref.value
    }

    function setAutoEnabled(next) {
      autoPref.value = next === true
      try {
        window.localStorage.setItem(AUTO_KEY, autoPref.value ? '1' : '0')
      } catch (error) {
        /* A full or unavailable store costs the persistence, not the setting. */
      }
      // The same "something changed" signal the toolbar already listens to.
      marksChanged()
    }

    /**
     * A short hold-off after this plugin focuses the composer itself.
     *
     * Cancelling the note box puts the caret back in the composer. If the reader
     * had also left auto-insert on, that focus would immediately insert the set
     * they had just walked away from — so a focus the plugin caused must not
     * count as the reader arriving.
     */
    var selfFocus = { until: 0 }

    function focusComposerQuietly() {
      var editor = composerRoot()
      if (editor === null) return
      selfFocus.until = Date.now() + 500
      try {
        editor.focus({ preventScroll: true })
      } catch (error) {
        /* Focus is a courtesy; the caller has already done its work. */
      }
    }

    /**
     * Tell every subscriber the mark set moved.
     *
     * Deliberately not called for a draft edit: the popup re-derives on this
     * signal, and re-deriving on every keystroke would walk the transcript
     * once per character typed.
     */
    function marksChanged() {
      for (var i = 0; i < watchers.length; i++) {
        try {
          watchers[i]()
        } catch (error) {
          /* A dead watcher must not stop the others. */
        }
      }
    }

    /**
     * A seat with no pixels: it borrows `input` and `inputActions` from the
     * composer's own dock and parks them where the popup can reach them. The
     * popup cannot take this seat itself, because `shell.overlay` is the only
     * seat that floats above every column.
     * @param {object} props - the dock's standard props plus the input face.
     * @returns {null} nothing is drawn.
     */
    function ConsentBridge(props) {
      var input = props.input
      var actions = props.inputActions
      var sessionId = props.sessionId

      // Runs after every render, so the parked draft is never a frame behind
      // what the user sees in the composer. A draft edit is parked silently:
      // it changes nothing that is on screen.
      React.useEffect(function () {
        var repaint = false
        if (input && typeof input.draft === 'string') shared.draft = input.draft
        if (input) {
          // Parked beside the draft because withdrawing a block has to know
          // whether the draft can be rewritten at all: chips are lost by a
          // rebuild, and a submission in flight must not be raced.
          shared.chips = Array.isArray(input.occurrences) ? input.occurrences.length : 0
          shared.phase = typeof input.phase === 'string' ? input.phase : null
        }
        if (actions && actions !== shared.actions) {
          shared.actions = actions
          repaint = true
        }
        if (sessionId !== undefined && sessionId !== shared.sessionId) {
          shared.sessionId = sessionId
          repaint = true
        }
        if (repaint) marksChanged()
      })

      // A seat that collapses (Session closed, view switched) must not leave a
      // dead draft behind for the popup to append to.
      React.useEffect(function () {
        return function () {
          shared.draft = null
          shared.chips = 0
          shared.phase = null
          if (shared.actions === actions) shared.actions = null
          if (shared.sessionId === sessionId) shared.sessionId = null
          marksChanged()
        }
      }, [])

      return null
    }

    // ---------------------------------------------------------------------
    // reading the selection
    // ---------------------------------------------------------------------

    /** A plain snapshot of a client rect, so later layout cannot move it. */
    function boxOf(node) {
      var rect = node.getBoundingClientRect()
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
    }

    /** The element a selection node lives in, or null when it has none. */
    function elementOf(node) {
      if (node === null || node === undefined) return null
      if (node.nodeType === 1) return node
      return node.parentElement || null
    }

    /** Whether this element is the popup itself. */
    function insidePopup(element) {
      var popup = document.querySelector('[' + POPUP_MARKER + ']')
      return popup !== null && popup.contains(element)
    }

    /**
     * The Session a transcript element belongs to.
     *
     * Read from the DOM rather than from the composer bridge because the key
     * half of an anchor is `stepKey(turn, step)`: two different Sessions can
     * both have a "step:1", so a mark must never be painted into a transcript
     * that only happens to share a key.
     * @param {Element|null} element - any node inside a Conversation.
     * @returns {string|null} the Session id, or null outside a Conversation.
     */
    function sessionOfElement(element) {
      if (element === null || element === undefined) return null
      var host = element.closest('[data-conversation-session]')
      if (host === null) return null
      var id = host.getAttribute('data-conversation-session')
      return id === null || id === '' ? null : id
    }

    /** The Session the popup reads and writes marks for. */
    function currentSessionId(element) {
      var fromElement = sessionOfElement(element === undefined ? null : element)
      if (fromElement !== null) return fromElement
      if (typeof shared.sessionId === 'string' && shared.sessionId !== '') return shared.sessionId
      return sessionOfElement(document.querySelector('[data-conversation-session]'))
    }

    /** The Turn a transcript element belongs to, when the host names one. */
    function turnOfElement(element) {
      if (element === null || element === undefined) return null
      var host = element.closest('[data-chat-turn]')
      if (host === null) return null
      var raw = host.getAttribute('data-chat-turn')
      var turn = raw === null || raw === '' ? NaN : Number(raw)
      return Number.isSafeInteger(turn) ? turn : null
    }

    /**
     * The last reply key seen per Session, with the Turn it belonged to.
     *
     * Off-screen flow items are unmounted, so scrolling up can leave an older
     * reply as the newest assistant step in the DOM. The cached Turn keeps that
     * older reply from being mistaken for the current one: a mounted Turn below
     * the cache is history, and the cached key stays in force until a newer Turn
     * is mounted.
     */
    var replyScopeCache = Object.create(null)

    /** The Conversation an element belongs to, or null outside one. */
    function conversationRootOf(element) {
      if (element === null || element === undefined) return null
      return element.closest('[data-conversation-session]')
    }

    /** The mounted Conversation for a Session id, when there is one. */
    function conversationRootForSession(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      var hosts = document.querySelectorAll('[data-conversation-session]')
      for (var i = 0; i < hosts.length; i++) {
        if (hosts[i].getAttribute('data-conversation-session') === sessionId) return hosts[i]
      }
      return null
    }

    /**
     * The assistant reply this plugin is answering: the newest one on screen.
     *
     * The draft is a reply to one message, not to the whole transcript. A
     * passage from an earlier turn still belongs to the reader's reading, but it
     * does not belong in *this* answer, so it must not be picked here. The
     * newest assistant step is found by Turn first (a later Turn always wins),
     * then by document order inside that Turn (the last step is the answer,
     * after any reasoning or tool steps). Hidden copies are included on purpose:
     * the newest reply still defines the scope even while its process panel is
     * folded, and a hidden element can never contain the visible selection.
     * @param {Element|null} [root] - the Conversation to search, or the document.
     * @returns {Element|null} the newest assistant-step flow item, or null.
     */
    function latestReplyElement(root) {
      var scope = root === null || root === undefined ? document : root
      var nodes = scope.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
      var best = null
      var bestTurn = null
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i]
        if (node === null || node.nodeType !== 1) continue
        var turn = turnOfElement(node)
        if (best === null) {
          best = node
          bestTurn = turn
          continue
        }
        if (turn === null) {
          // No Turn to compare: document order is still conversation order.
          if (bestTurn === null) best = node
          continue
        }
        if (bestTurn === null || turn >= bestTurn) {
          best = node
          bestTurn = turn
        }
      }
      return best
    }

    /**
     * Whether the transcript names its Turns at all.
     *
     * A host that does not expose the marker cannot be scoped. Saying so is
     * different from "there is no reply": the first keeps the old behaviour
     * working, the second is a genuine empty scope.
     * @param {Element|null} [root] - the Conversation to search, or the document.
     */
    function transcriptHasTurns(root) {
      var scope = root === null || root === undefined ? document : root
      return (
        scope.querySelector('[data-chat-turn]') !== null ||
        scope.querySelector('[data-chat-flow-kind]') !== null
      )
    }

    /**
     * The durable key of a reply.
     *
     * `data-chat-node-key` names the node independently of which visible group
     * part is mounted, so a reply that is split into a response part and a
     * reasoning part keeps one key across all of them. The anchor key is the
     * fallback for a fixture or a host that only carries the anchor marker, and
     * it is stable there too.
     */
    function replyKeyOf(element) {
      if (element === null || element === undefined) return null
      var key = element.getAttribute('data-chat-node-key')
      if (key === null || key === '') key = element.getAttribute('data-chat-anchor-key')
      return key === null || key === '' ? null : key
    }

    /**
     * The newest reply's key inside one Conversation (or the document).
     *
     * A mounted Turn that is older than the cached one does not replace the
     * cache: the reply being answered has simply scrolled out of the window.
     * @param {Element|null} root - the Conversation to search, or the document.
     */
    function latestReplyKey(root) {
      var reply = latestReplyElement(root)
      var key = replyKeyOf(reply)
      var sessionId = sessionOfElement(root)
      if (sessionId === null) return key
      var turn = reply === null ? null : turnOfElement(reply)
      var cached = replyScopeCache[sessionId]
      if (key === null) return cached === undefined ? null : cached.key
      if (cached !== undefined && cached.turn !== null && turn !== null && turn < cached.turn) {
        return cached.key
      }
      replyScopeCache[sessionId] = { key: key, turn: turn }
      return key
    }

    /**
     * The key of the newest reply, or null when the host cannot name one.
     * @param {Element|null} [element] - an element of the Conversation to scope.
     */
    function currentReplyKey(element) {
      return latestReplyKey(conversationRootOf(element))
    }

    /** Whether a selection sits inside the one reply this plugin answers. */
    function insideCurrentReply(element) {
      var root = conversationRootOf(element)
      var key = latestReplyKey(root)
      if (key === null) {
        // A host with no Turn markers predates this scope: keep working as before.
        return !transcriptHasTurns(root)
      }
      var anchor = element.closest(ANCHOR_SELECTOR)
      // The node key is what makes a split reply whole: the response part and
      // the reasoning part of one assistant step carry the same key even when
      // neither contains the other. Where the host does not expose it, the
      // anchor key is the same string in the ordinary case, and containment is
      // the last honest answer.
      if (anchor !== null && replyKeyOf(anchor) === key) return true
      var reply = latestReplyElement(root)
      return reply !== null && replyKeyOf(reply) === key && reply.contains(element)
    }

    /**
     * The selection worth quoting, or null when there is none.
     *
     * A field being edited is never quoted, a modal's selection is never
     * quoted, and the popup never quotes itself. Only the newest assistant reply
     * is fair game: the draft answers that message, so a passage from an earlier
     * turn must not be able to join it. Selections elsewhere in the shell — the
     * sidebar, a preview — are rejected for the same reason.
     * @returns {object|null} the quote, where it sat, and its anchor when one
     *   exists.
     */
    function readSelection() {
      var selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null

      var text = selection.toString()
      if (text === '' || text.trim() === '') return null

      var range = selection.getRangeAt(0)
      var element = elementOf(range.commonAncestorContainer)
      if (element === null) return null
      if (element.closest(EDITABLE_SELECTOR)) return null
      if (element.closest(MODAL_SELECTOR)) return null
      if (insidePopup(element)) return null
      if (!insideCurrentReply(element)) return null

      var box = boxOf(range)
      if (box.width === 0 && box.height === 0) {
        // A zero-size range still has a host worth hanging off, and a popup on
        // the paragraph beats one stuck at 0,0.
        var host = element.closest('p, li, pre, code, td, h1, h2, h3, h4, h5, h6, div')
        box = boxOf(host === null ? element : host)
      }
      if (box.width === 0 && box.height === 0) return null

      return { text: text, box: box, anchor: anchorOf(range, text) }
    }

    // ---------------------------------------------------------------------
    // marks: the whitespace-free projection
    // ---------------------------------------------------------------------

    /** Tags whose text is not readable content. */
    var NON_TEXT_TAGS = { SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true }

    /** Whether an element's subtree is invisible and must not be walked. */
    function isHidden(element) {
      if (NON_TEXT_TAGS[element.tagName] === true) return true
      if (element.hidden === true) return true
      var style = window.getComputedStyle(element)
      return style.display === 'none' || style.visibility === 'hidden'
    }

    /**
     * The projection both sides of an anchor comparison are reduced to.
     *
     * `selection.toString()` inserts block separators that no DOM walk
     * reproduces, and different whitespace survives on each side. Dropping
     * whitespace entirely erases both differences; a whitespace-free quote can
     * afford that because the prefix and suffix still say which occurrence it
     * was.
     * @param {string} value - raw text.
     * @returns {string} the same text without whitespace.
     */
    function pack(value) {
      var out = ''
      for (var i = 0; i < value.length; i++) {
        var ch = value.charAt(i)
        if (ch.trim() !== '') out += ch
      }
      return out
    }

    /**
     * Every visible character under `root`, in document order, with whitespace
     * dropped and a flat (node, characterOffset) pair per kept character.
     *
     * Hidden subtrees are skipped because a grouped turn keeps a collapsed copy
     * and an expanded copy in the DOM at once, and a mark must land on the one
     * the reader can see.
     * @param {Element} root - the element to walk.
     * @returns {{packed: string, map: Array}} the text and its offsets.
     */
    function packedMapOf(root) {
      var packed = ''
      var map = []

      function collect(node) {
        var children = node.childNodes
        for (var i = 0; i < children.length; i++) {
          var child = children[i]
          if (child.nodeType === 3) {
            var data = child.data
            for (var j = 0; j < data.length; j++) {
              var ch = data.charAt(j)
              if (ch.trim() === '') continue
              packed += ch
              map.push(child, j)
            }
          } else if (child.nodeType === 1) {
            if (isHidden(child)) continue
            collect(child)
          }
        }
      }

      collect(root)
      return { packed: packed, map: map }
    }

    /** A DOM Range covering `[start, end)` of a packed map, or null. */
    function rangeFromIndices(full, start, end) {
      if (start < 0 || end <= start) return null
      var last = end - 1
      if (last * 2 + 1 >= full.map.length) return null
      var range = document.createRange()
      try {
        range.setStart(full.map[start * 2], full.map[start * 2 + 1])
        range.setEnd(full.map[last * 2], full.map[last * 2 + 1] + 1)
      } catch (error) {
        return null
      }
      return range
    }

    /** Every index at which `needle` starts inside `haystack`, capped. */
    function occurrencesOf(haystack, needle, limit) {
      var out = []
      if (needle === '') return out
      var at = haystack.indexOf(needle)
      while (at !== -1 && out.length < limit) {
        out.push(at)
        at = haystack.indexOf(needle, at + 1)
      }
      return out
    }

    /** Centre-to-centre distance between two rects. */
    function rectDistance(a, b) {
      var dx = (a.left + a.right) / 2 - (b.left + b.right) / 2
      var dy = (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2
      return Math.sqrt(dx * dx + dy * dy)
    }

    /**
     * The anchor for a live selection: which flow item it sits in, and where
     * inside that item it starts.
     *
     * The occurrence is chosen geometrically against the selection's own rect,
     * because at this moment the DOM is exactly what the reader selected from —
     * no hint or context has to be guessed first.
     * @param {Range} range - the live selection range.
     * @param {string} text - the live selection text.
     * @returns {object|null} the anchor, or null when there is nothing durable
     *   to hang a mark on.
     */
    function anchorOf(range, text) {
      var element = elementOf(range.commonAncestorContainer)
      if (element === null) return null
      var anchorElement = element.closest(ANCHOR_SELECTOR)
      if (anchorElement === null) return null

      var quote = pack(text)
      if (quote === '' || quote.length > MAX_QUOTE_CHARS) return null

      var full = packedMapOf(anchorElement)
      var candidates = occurrencesOf(full.packed, quote, MAX_OCCURRENCES)
      if (candidates.length === 0) return null

      var target = boxOf(range)
      var best = null
      for (var i = 0; i < candidates.length; i++) {
        var candidate = rangeFromIndices(full, candidates[i], candidates[i] + quote.length)
        if (candidate === null) continue
        var distance = rectDistance(boxOf(candidate), target)
        if (best === null || distance < best.distance) {
          best = { index: candidates[i], distance: distance }
        }
      }
      if (best === null) return null

      return {
        key: anchorElement.getAttribute('data-chat-anchor-key'),
        sessionId: sessionOfElement(anchorElement),
        replyKey: currentReplyKey(anchorElement),
        quote: quote,
        prefix: full.packed.slice(Math.max(0, best.index - CONTEXT_CHARS), best.index),
        suffix: full.packed.slice(
          best.index + quote.length,
          best.index + quote.length + CONTEXT_CHARS
        ),
        index: best.index,
        text: text.slice(0, MAX_TEXT_CHARS),
      }
    }

    /**
     * Where a stored mark sits inside one anchor's current text.
     *
     * Every occurrence of the quote is scored on its context and on how far it
     * has drifted from where the mark was made. An ambiguous tie is refused
     * rather than guessed: a note that paints the wrong sentence is worse than
     * one that briefly cannot paint at all.
     * @param {object} full - the anchor's packed map.
     * @param {object} mark - the stored mark.
     * @returns {{start: number, end: number}|null} the kept-character span.
     */
    function locate(full, mark) {
      if (mark === null || typeof mark !== 'object') return null
      if (typeof mark.quote !== 'string' || mark.quote === '') return null
      // A hand-edited or half-written record must degrade, not throw.
      var prefix = typeof mark.prefix === 'string' ? mark.prefix : ''
      var suffix = typeof mark.suffix === 'string' ? mark.suffix : ''

      var candidates = occurrencesOf(full.packed, mark.quote, MAX_OCCURRENCES)
      if (candidates.length === 0) return null

      var best = null
      for (var i = 0; i < candidates.length; i++) {
        var index = candidates[i]
        var score = 0
        if (prefix !== '') {
          var before = full.packed.slice(Math.max(0, index - prefix.length), index)
          if (before === prefix) score += 4
        }
        if (suffix !== '') {
          var after = full.packed.slice(
            index + mark.quote.length,
            index + mark.quote.length + suffix.length
          )
          if (after === suffix) score += 4
        }
        if (typeof mark.index === 'number') {
          score += Math.max(0, 2 - Math.abs(index - mark.index) / 200)
        }
        if (best === null || score > best.score) best = { index: index, score: score }
      }
      if (best === null) return null
      // Context disagreed everywhere and the quote is not unique: do not guess.
      if (best.score < 4 && candidates.length > 1) return null

      return { start: best.index, end: best.index + mark.quote.length }
    }

    // ---------------------------------------------------------------------
    // marks: storage
    // ---------------------------------------------------------------------

    /** Marks are per Session, in this browser, under one key. */
    function readStore() {
      try {
        var raw = window.localStorage.getItem(MARKS_KEY)
        if (raw === null || raw === '') return {}
        var parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return parsed
      } catch (error) {
        return {}
      }
    }

    function writeStore(store) {
      try {
        window.localStorage.setItem(MARKS_KEY, JSON.stringify(store))
      } catch (error) {
        /* A full or unavailable store costs the persistence, not the feature. */
      }
    }

    /**
     * The last read result, so re-deriving after every transcript mutation
     * does not re-parse the whole store. Every writer in this module drops it.
     */
    var marksCache = { sessionId: null, marks: null }

    function forgetMarks() {
      marksCache.sessionId = null
      marksCache.marks = null
    }

    /** The marks recorded for one Session, oldest first. */
    function marksOf(sessionId) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      if (marksCache.sessionId === sessionId && marksCache.marks !== null) return marksCache.marks
      var entry = readStore()[sessionId]
      var marks = []
      if (entry !== null && typeof entry === 'object' && Array.isArray(entry.marks)) {
        marks = entry.marks.filter(function (mark) {
          return (
            mark !== null &&
            typeof mark === 'object' &&
            typeof mark.id === 'string' &&
            typeof mark.key === 'string' &&
            typeof mark.quote === 'string' &&
            mark.quote !== ''
          )
        })
      }
      marksCache.sessionId = sessionId
      marksCache.marks = marks
      return marks
    }

    /** The marks a Session has not yet handed to the composer. */
    function pendingOf(marks) {
      var out = []
      for (var i = 0; i < marks.length; i++) {
        var at = marks[i].exportedAt
        if (typeof at !== 'number' || at === 0) out.push(marks[i])
      }
      return out
    }

    /**
     * The note written on a mark, or "" when the pick carries none.
     *
     * A note is what the reader *says* about a passage. It is not required for a
     * pick to be complete: some picks are a quotation and nothing more.
     */
    function noteOf(mark) {
      if (mark === null || typeof mark !== 'object') return ''
      return typeof mark.note === 'string' ? mark.note : ''
    }

    /**
     * Whether a pick asks to be handed to the composer at all.
     *
     * This is the whole difference between the three gestures, and the reason
     * 「标记」 and 「引用」 are both offered:
     *
     *   「标记」           highlighted, and nothing else. A note to yourself, or
     *                      a passage worth remembering, that has no place in the
     *                      message being written. Never handed over.
     *   「引用」           the passage itself is part of the answer: handed over
     *                      as its own quote block, with no note.
     *   「引用并附注」     the passage and a sentence about it: a quote block, a
     *                      blank line, then the note.
     *
     * A note always implies a quotation — there is no way to write a sentence
     * about a passage and not want the passage — so `quoted` is the single flag
     * the export reads, and a note sets it.
     */
    function quotedOf(mark) {
      if (mark === null || typeof mark !== 'object') return false
      if (mark.quoted === true) return true
      // A mark carrying a note was made by 「引用并附注」, which always quotes.
      // Records written before `quoted` existed are read this way.
      return noteOf(mark).trim() !== ''
    }

    /** The picks of a set that ask to be handed to the composer, oldest first. */
    function quotableOf(marks) {
      var out = []
      for (var i = 0; i < marks.length; i++) {
        if (quotedOf(marks[i])) out.push(marks[i])
      }
      return out
    }

    /**
     * The picks that belong to the reply currently being answered.
     *
     * A pick from an earlier turn is still a highlight on the page, but it is
     * not part of *this* reply: handing it to the composer would put words about
     * an old message under the newest one. The scope is therefore enforced again
     * at hand-over time, not only when the selection is made — a reply that
     * arrived after an un-handed pick moves that pick out of scope.
     *
     * A host that cannot name a reply key is left alone, so an older shell keeps
     * its old behaviour instead of silently losing every pending pick.
     * @param {Array} marks - picks from one Session.
     * @param {string} [sessionId] - whose Conversation supplies the scope.
     * @returns {Array} those that may enter this reply's draft.
     */
    function scopedOf(marks, sessionId) {
      // No mounted Conversation for this Session means there is no scope to
      // compare against — and searching the document would let another
      // Session's reply decide what this one may send.
      var root = conversationRootForSession(sessionId)
      var key = root === null ? null : latestReplyKey(root)
      if (key === null) return marks
      var out = []
      for (var i = 0; i < marks.length; i++) {
        var mark = marks[i]
        if (mark === null || typeof mark !== 'object') continue
        if (mark.replyKey === key) {
          out.push(mark)
          continue
        }
        // A record written before reply keys existed still knows its anchor key.
        // In the common case the reply's node key and the assistant step's anchor
        // key are the same string, so a pending pick from the current reply is
        // not lost on upgrade; an earlier turn's key is different and stays out.
        var legacy = mark.replyKey === null || mark.replyKey === undefined || mark.replyKey === ''
        if (legacy && mark.key === key) out.push(mark)
      }
      return out
    }

    /** A fresh identity without depending on crypto being present. */
    function newId() {
      try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
          return window.crypto.randomUUID()
        }
      } catch (error) {
        /* Fall through to the counter. */
      }
      newId.counter = (newId.counter || 0) + 1
      return 'mark-' + Date.now().toString(36) + '-' + newId.counter
    }

    /** Two anchors at the same place are the same mark, however it was made. */
    function samePlace(mark, anchor) {
      return mark.key === anchor.key && mark.index === anchor.index && mark.quote === anchor.quote
    }

    /**
     * Record one anchor as a mark and return it as stored.
     *
     * The mark is returned with its identity because the note box needs the id
     * it is about to write a note onto, and re-deriving it from the store would
     * be a second read of something just written.
     * @param {string} sessionId - whose set this mark joins.
     * @param {object} anchor - the anchor to record.
     * @param {string} [note] - the note typed with it, when there is one.
     * @param {boolean} [quoted] - whether the pick asks to be handed over.
     * @returns {object|null} the stored mark, or null when it could not be
     *   recorded (no Session to file it under).
     */
    function addMark(sessionId, anchor, note, quoted) {
      if (typeof sessionId !== 'string' || sessionId === '') return null
      var store = readStore()
      var entry = store[sessionId]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.marks)) {
        entry = { at: 0, marks: [] }
      }
      // The note may arrive as the third argument (the popup's own path) or on
      // the anchor itself (a mark built by hand, or a check). Both mean the
      // same thing, and the explicit argument wins.
      var text = typeof note === 'string' ? note : typeof anchor.note === 'string' ? anchor.note : ''
      // Where the pick asks to be quoted may arrive as the fourth argument (the
      // popup's own path) or on the anchor itself (a mark built by hand, or a
      // check). A note is itself a reason to quote, so that is the floor.
      var wantsQuote =
        quoted === true
          ? true
          : quoted === false
            ? false
            : anchor.quoted === true
              ? true
              : text.trim() !== ''
      // The reply a pick belongs to. Stored beside the anchor because the scope
      // has to survive the reply scrolling away: hand-over is decided against
      // the newest reply, and this is how an old pick is recognised as old.
      var replyKey =
        typeof anchor.replyKey === 'string' && anchor.replyKey !== '' ? anchor.replyKey : null
      var existing = marksOf(sessionId)
      var already = null
      for (var i = 0; i < existing.length; i++) {
        if (samePlace(existing[i], anchor)) already = existing[i]
      }
      var stored = already
      if (already === null) {
        stored = {
          id: newId(),
          key: anchor.key,
          replyKey: replyKey,
          quote: anchor.quote,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          index: anchor.index,
          text: anchor.text,
          note: text,
          quoted: wantsQuote,
          at: Date.now(),
          // A mark starts unhanded to the composer. This is what lets a set
          // collected over several picks be handed over exactly once.
          exportedAt: 0,
        }
        var next = existing.concat([stored])
        if (next.length > MAX_MARKS_PER_SESSION) next = next.slice(next.length - MAX_MARKS_PER_SESSION)
        entry.marks = next
      } else {
        // Picking an already-picked passage is not a no-op: the newer gesture is
        // a correction, and it wins — 「引用」 can promote a 「标记」, and a note
        // can be replaced. What the passage is *now* is what was last asked of
        // it, which is the only reading a reader can predict.
        //
        // A corrected pick goes back into the queue. `exportedAt` records that
        // *this* pick was written into the draft, so once the pick itself
        // changes that record is no longer true — and a note added after an
        // earlier 汇总 has never been anywhere.
        var changed = noteOf(already) !== text || quotedOf(already) !== wantsQuote
        stored = Object.assign({}, already, {
          note: text,
          quoted: wantsQuote,
          exportedAt: changed ? 0 : already.exportedAt,
        })
        if (replyKey !== null) stored.replyKey = replyKey
        entry.marks = entry.marks.map(function (mark) {
          return mark.id === stored.id ? stored : mark
        })
      }
      entry.at = Date.now()
      store[sessionId] = entry
      writeStore(prune(store))
      forgetMarks()
      return stored
    }

    /**
     * Write the note on an existing mark, which is what an opening note box
     * does when the passage was already picked.
     * @returns {Array} the Session's marks after the write.
     */
    function setMarkNote(sessionId, id, note) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      var store = readStore()
      var entry = store[sessionId]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.marks)) {
        return marksOf(sessionId)
      }
      entry.marks = entry.marks.map(function (mark) {
        if (mark.id !== id) return mark
        // Writing a note on an existing pick turns it into a quotation with a
        // note, whatever it was before — the box is the 「引用并附注」 gesture.
        // And, like any other changed pick, it goes back into the queue.
        var next = typeof note === 'string' ? note : ''
        var changed = noteOf(mark) !== next || !quotedOf(mark)
        return Object.assign({}, mark, {
          note: next,
          quoted: true,
          exportedAt: changed ? 0 : mark.exportedAt,
        })
      })
      entry.at = Date.now()
      store[sessionId] = entry
      writeStore(prune(store))
      forgetMarks()
      return marksOf(sessionId)
    }

    /** Forget one mark. */
    function removeMark(sessionId, id) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      var store = readStore()
      var entry = store[sessionId]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.marks)) return []
      var next = entry.marks.filter(function (mark) {
        return mark.id !== id
      })
      entry.marks = next
      entry.at = Date.now()
      store[sessionId] = entry
      writeStore(prune(store))
      forgetMarks()
      return next
    }

    /**
     * Record that a set of marks has been handed to the composer.
     *
     * `exportedAt` is the queue's flag — it is what keeps a set from being
     * inserted twice — and it doubles as the batch id: every mark handed over in
     * one insert carries the same stamp. The rest of the record is what makes
     * 「取消标记」 able to take the block back out of the draft:
     *
     *   exportedChunk  the exact text that was inserted for this mark, trailing
     *                  blank line included, so it can be found verbatim later.
     *   exportedLead   the newline the insert added in front of the batch's
     *                  first block ('' or '\n'), so removing the last block can
     *                  take that newline with it instead of leaving the draft
     *                  non-empty and blocking the next automatic insert.
     *
     * @param {string} sessionId - the Session whose marks were handed over.
     * @param {Array} items - mark ids, or `{id, chunk}` records.
     * @param {string} [lead] - the separator inserted before the first block.
     * @returns {Array} the Session's marks after the write.
     */
    function markExported(sessionId, items, lead) {
      if (typeof sessionId !== 'string' || sessionId === '' || items.length === 0) {
        return marksOf(sessionId)
      }
      var store = readStore()
      var entry = store[sessionId]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.marks)) {
        return marksOf(sessionId)
      }
      var records = {}
      for (var i = 0; i < items.length; i++) {
        var item = items[i]
        if (typeof item === 'string') {
          records[item] = null
        } else if (item !== null && typeof item === 'object' && typeof item.id === 'string') {
          records[item.id] = item
        }
      }
      var separator = lead === '\n' ? '\n' : ''
      var stamp = Date.now()
      entry.marks = entry.marks.map(function (mark) {
        if (!Object.prototype.hasOwnProperty.call(records, mark.id)) return mark
        var record = records[mark.id]
        var next = Object.assign({}, mark, { exportedAt: stamp })
        if (record !== null && record !== undefined) {
          var chunk = typeof record.chunk === 'string' ? record.chunk : ''
          next.exportedChunk = chunk
          next.exportedLead = separator
        }
        return next
      })
      entry.at = stamp
      store[sessionId] = entry
      writeStore(prune(store))
      forgetMarks()
      return marksOf(sessionId)
    }

    /**
     * Put one removed mark back, which is what 「撤销」 does after an unmark.
     *
     * The whole record goes back, including its export bookkeeping, so the
     * highlight, the note and the queue state all return to where they were.
     * @param {string} sessionId - whose set the mark rejoins.
     * @param {object} mark - the record that was removed.
     * @returns {Array} the Session's marks after the write.
     */
    function restoreMark(sessionId, mark) {
      if (typeof sessionId !== 'string' || sessionId === '') return []
      if (mark === null || typeof mark !== 'object' || typeof mark.id !== 'string') {
        return marksOf(sessionId)
      }
      var store = readStore()
      var entry = store[sessionId]
      if (entry === null || typeof entry !== 'object' || !Array.isArray(entry.marks)) {
        entry = { at: 0, marks: [] }
      }
      var exists = false
      for (var i = 0; i < entry.marks.length; i++) {
        if (entry.marks[i] !== null && entry.marks[i].id === mark.id) exists = true
      }
      if (!exists) {
        // Back into its old place, not at the end: the set is ordered by when a
        // pick was made, and an undo is not a new pick.
        entry.marks = entry.marks.concat([mark]).sort(function (a, b) {
          var left = a !== null && typeof a.at === 'number' ? a.at : 0
          var right = b !== null && typeof b.at === 'number' ? b.at : 0
          return left - right
        })
      }
      entry.at = Date.now()
      store[sessionId] = entry
      writeStore(prune(store))
      forgetMarks()
      return marksOf(sessionId)
    }

    /** Keep the store from growing one abandoned Session at a time. */
    function prune(store) {
      var keys = Object.keys(store)
      if (keys.length <= MAX_SESSIONS) return store
      keys.sort(function (a, b) {
        var left = store[a] && typeof store[a].at === 'number' ? store[a].at : 0
        var right = store[b] && typeof store[b].at === 'number' ? store[b].at : 0
        return left - right
      })
      var keep = {}
      var kept = keys.slice(keys.length - MAX_SESSIONS)
      for (var i = 0; i < kept.length; i++) keep[kept[i]] = store[kept[i]]
      return keep
    }

    // ---------------------------------------------------------------------
    // marks: painting
    // ---------------------------------------------------------------------

    /**
     * The mark stylesheet.
     *
     * The colour is a literal, not a `var()` on a theme token, for two
     * reasons: the theme has no highlighter token at all, and a custom
     * property is not reliably inherited into a highlight pseudo-element —
     * which is how an earlier version of this rule, asking for a translucent
     * brand blue, ended up painting a flat grey.
     *
     * Pinning `color` next to `background-color` is what lets one rule work on
     * both themes. A highlighter is a bright bar with dark text on it: in the
     * light theme the text was already dark, so nothing changes, and in the
     * dark theme the marked run becomes the one passage that reads as ink on
     * yellow — the paper-highlighter effect, without any theme detection.
     */
    var MARK_CSS =
      '::highlight(' +
      HIGHLIGHT_NAME +
      '){background-color:rgba(255,212,64,0.8);color:#1b1b1b;}' +
      '::highlight(' +
      PREVIEW_HIGHLIGHT_NAME +
      '){background-color:rgba(77,107,254,0.3);color:#1b1b1b;}' +
      '[data-select-consent-popup] .dsh-select-consent-stack{' +
      'box-sizing:border-box;width:100%;display:flex;flex-direction:column;gap:7px;}' +
      '[data-select-consent-popup] .dsh-select-consent-quick-row{' +
      'display:flex;align-items:center;gap:8px;}' +
      '[data-select-consent-popup] .dsh-select-consent-quick{' +
      'appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:7px;' +
      'height:36px;margin:0;padding:7px 16px;border-radius:9px;' +
      'font:inherit;font-size:15px;line-height:20px;cursor:pointer;white-space:nowrap;' +
      'transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease;}' +
      '[data-select-consent-popup] .dsh-select-consent-emoji{font-size:20px;line-height:1;}' +
      '[data-select-consent-popup] .dsh-select-consent-quick:focus-visible{' +
      'outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;}' +
      '[data-select-consent-popup] .dsh-select-consent-quick:active{transform:scale(.97);}' +
      '[data-select-consent-popup] .dsh-select-consent-quick--disagree{' +
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));' +
      'background:var(--dsw-alias-bg-module-platform,transparent);' +
      'color:var(--dsw-alias-label-primary,#1a1a1a);}' +
      '[data-select-consent-popup] .dsh-select-consent-quick--disagree:hover{' +
      'background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06));}' +
      '[data-select-consent-popup] .dsh-select-consent-quick--agree{' +
      'border:1px solid var(--dsw-alias-state-success-primary,#2e7d32);' +
      'background:var(--dsw-alias-state-success-primary,#2e7d32);color:#fff;font-weight:600;}' +
      '[data-select-consent-popup] .dsh-select-consent-quick--agree:hover{filter:brightness(.94);}' +
      '[data-select-consent-popup] .dsh-select-consent-quick{transition:background-color 120ms ease,border-color 120ms ease,box-shadow 120ms ease,transform 120ms ease;}' +
      '[data-select-consent-popup] .dsh-select-consent-note{' +
      'display:block;box-sizing:border-box;width:100%;height:36px;min-height:36px;max-height:36px;' +
      'padding:7px 10px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));' +
      'border-radius:8px;background:var(--dsw-alias-bg-module-platform,transparent);' +
      'color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:14px;line-height:20px;' +
      'resize:none;outline:none;user-select:text;transition:border-color 120ms ease,box-shadow 120ms ease;}' +
      '[data-select-consent-popup] .dsh-select-consent-note::placeholder{' +
      'color:var(--dsw-alias-label-tertiary,#999);opacity:1;}' +
      '[data-select-consent-popup] .dsh-select-consent-note:focus{' +
      'border-color:var(--dsw-alias-brand-primary,#4d6bfe);' +
      'box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 22%,transparent);}' +
      '@keyframes dsh-select-consent-in{' +
      '0%{opacity:0;transform:translateY(4px) scale(.97);}' +
      '100%{opacity:1;transform:translateY(0) scale(1);}}' +
      // The animation is armed by an attribute rather than running on mount. The
      // popup is measured with getBoundingClientRect before it is shown, and that
      // measurement includes transforms — so a scale running at mount time would
      // position the card against a box 3% too small.
      '[data-select-consent-popup][data-enter="true"]{' +
      'animation:dsh-select-consent-in 150ms cubic-bezier(.22,.9,.24,1);}' +
      '@media(prefers-reduced-motion:reduce){[data-select-consent-popup] .dsh-select-consent-quick,' +
      '[data-select-consent-popup] .dsh-select-consent-note{transition:none;}' +
      '[data-select-consent-popup][data-enter="true"]{animation:none;}}' +
      // The peek button: a small round control, not a card and not a word.
      //
      // It has to be aimable with the pointer at the size it is drawn, without
      // becoming another panel over the text. So: 32px, a hairline edge and a
      // one-pixel shadow — enough to read as a control — at 72% opacity, and it
      // gains contrast and a lift only when the pointer is on it. The icon is a
      // speech bubble because the gesture is "say something about this"; at
      // 18px a drawn glyph is legible, and the label is still on `aria-label`
      // for a screen reader and on `title` for a mouse.
      //
      // The arrival is one small pop plus a halo that expands once and fades.
      // A reader who has just released the pointer has not asked for a card, so
      // the button must stay quiet; but a control that only fades in can be
      // missed entirely. The pop says "press me" in under 300ms, the halo says
      // it once more, and then both are still.
      '[data-select-consent-peek]{' +
      'display:inline-flex;align-items:center;justify-content:center;' +
      'box-sizing:border-box;width:32px;height:32px;margin:0;padding:0;' +
      'border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.14));' +
      'border-radius:50%;background:var(--dsw-alias-bg-overlay,#ffffff);' +
      'color:var(--dsw-alias-label-secondary,#6b6b6b);' +
      'box-shadow:0 1px 3px rgba(0,0,0,.10);opacity:.72;' +
      'cursor:pointer;user-select:none;-webkit-appearance:none;appearance:none;' +
      'transition:opacity 120ms ease,color 120ms ease,box-shadow 120ms ease,transform 120ms ease;}' +
      '[data-select-consent-peek]:hover,[data-select-consent-peek]:focus-visible{' +
      'opacity:1;color:var(--dsw-alias-label-primary,#1a1a1a);' +
      'box-shadow:0 4px 12px rgba(0,0,0,.16);transform:scale(1.06);}' +
      '[data-select-consent-peek]:active{transform:scale(.97);}' +
      '[data-select-consent-peek]:focus-visible{' +
      'outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px;}' +
      // The halo is a pseudo-element so it can grow past the button without
      // changing its measured box. It is not part of the hit target.
      '[data-select-consent-peek]::before{' +
      'content:"";position:absolute;inset:-4px;border-radius:50%;' +
      'border:2px solid var(--dsw-alias-brand-primary,#4d6bfe);' +
      'opacity:0;pointer-events:none;}' +
      // A short pop, then still. Anything that travels draws the eye exactly
      // when the reader is deciding whether to be interrupted, so the motion
      // stays inside the button's own footprint and ends before the 4s life.
      '@keyframes dsh-select-consent-peek-in{' +
      '0%{opacity:0;transform:scale(.86);}' +
      '55%{opacity:.82;transform:scale(1.05);}' +
      '100%{opacity:.72;transform:scale(1);}}' +
      '@keyframes dsh-select-consent-peek-halo{' +
      '0%{opacity:.5;transform:scale(.72);}' +
      '100%{opacity:0;transform:scale(1.45);}}' +
      '[data-select-consent-peek][data-enter="true"]{' +
      'animation:dsh-select-consent-peek-in 260ms cubic-bezier(.22,.9,.24,1);}' +
      '[data-select-consent-peek][data-enter="true"]::before{' +
      'animation:dsh-select-consent-peek-halo 760ms ease-out 120ms;}' +
      '@media(prefers-reduced-motion:reduce){' +
      '[data-select-consent-peek]{transition:none;}' +
      '[data-select-consent-peek][data-enter="true"],[data-select-consent-peek][data-enter="true"]::before{' +
      'animation:none;}}'

    /** The highlight registry, or null where the browser cannot paint one. */
    function highlightRegistry() {
      try {
        if (typeof window.Highlight !== 'function') return null
        if (window.CSS === undefined || window.CSS.highlights === undefined) return null
        return window.CSS.highlights
      } catch (error) {
        return null
      }
    }

    /**
     * Rebuild every mark's Range against the transcript as it is right now and
     * hand the whole set to the highlight registry in one write.
     *
     * Ranges are never stored: the transcript unmounts off-screen flow items
     * and re-renders a streaming message continuously, so the only durable
     * description of a mark is its anchor.
     * @param {string|null} sessionId - whose marks these are.
     * @param {Array} marks - the Session's marks.
     * @returns {Array} `{mark, range, sessionId}` for everything on screen,
     *   which is also the hit-test set for unmarking.
     */
    function deriveMarks(sessionId, marks) {
      var derived = []
      var registry = highlightRegistry()

      // The common case is a Session with nothing marked; it must cost a
      // length check and not a transcript scan.
      if (marks.length === 0) {
        if (registry !== null) {
          try {
            registry.delete(HIGHLIGHT_NAME)
          } catch (error) {
            /* Nothing painted is nothing to remove. */
          }
        }
        return derived
      }

      var byKey = {}
      var i
      for (i = 0; i < marks.length; i++) {
        var key = marks[i].key
        if (byKey[key] === undefined) byKey[key] = []
        byKey[key].push(marks[i])
      }

      var elements = document.querySelectorAll(ANCHOR_SELECTOR)
      var maps = {}
      var ranges = []
      for (i = 0; i < elements.length; i++) {
        var element = elements[i]
        var elementSession = sessionOfElement(element)
        // A transcript mounted for a different Session may carry the very same
        // step key; it must not receive these marks. An unknown Session is
        // taken at face value, so a host without the marker still paints.
        if (sessionId !== null && elementSession !== null && elementSession !== sessionId) {
          continue
        }
        var elementKey = element.getAttribute('data-chat-anchor-key')
        var wanted = byKey[elementKey]
        if (wanted === undefined) continue
        var full = maps[elementKey]
        if (full === undefined) {
          full = packedMapOf(element)
          maps[elementKey] = full
        }
        for (var j = 0; j < wanted.length; j++) {
          var span = locate(full, wanted[j])
          if (span === null) continue
          var range = rangeFromIndices(full, span.start, span.end)
          if (range === null) continue
          derived.push({
            mark: wanted[j],
            range: range,
            sessionId: elementSession === null ? sessionId : elementSession,
          })
          ranges.push(range)
        }
      }

      if (registry !== null) {
        try {
          if (ranges.length === 0) registry.delete(HIGHLIGHT_NAME)
          else registry.set(HIGHLIGHT_NAME, new window.Highlight(...ranges))
        } catch (error) {
          /* An unpaintable set must not break the composer. */
        }
      }
      return derived
    }

    /** The mark under a viewport point, or null. */
    function markAtPoint(derived, x, y) {
      for (var i = derived.length - 1; i >= 0; i--) {
        var rects = derived[i].range.getClientRects()
        for (var j = 0; j < rects.length; j++) {
          var rect = rects[j]
          if (rect.width === 0 && rect.height === 0) continue
          if (
            x >= rect.left - 2 &&
            x <= rect.right + 2 &&
            y >= rect.top - 2 &&
            y <= rect.bottom + 2
          ) {
            return derived[i]
          }
        }
      }
      return null
    }

    // ---------------------------------------------------------------------
    // writing the composer
    // ---------------------------------------------------------------------

    /** The composer's editable root, when a Session has one on screen. */
    function composerRoot() {
      return document.querySelector(COMPOSER_SELECTOR)
    }

    /** Drop only what a selection picks up at its very end. */
    function tidyQuote(value) {
      return value.replace(/\s+$/, '')
    }

    /**
     * The selection as a Markdown blockquote.
     *
     * The marker is the point of the feature: without it the model receives a
     * wall of its own prose with no way to tell which words are the user's
     * answer and which are the text being answered. A blank line *inside* the
     * quote stays quoted (`>` alone), so a multi-paragraph quote does not fall
     * apart into two blocks.
     * @param {string} quote - the selected text, already tidied.
     * @returns {string} the quote with every line marked.
     */
    function quoteBlock(quote) {
      var lines = quote.split('\n')
      var out = []
      for (var i = 0; i < lines.length; i++) {
        out.push(lines[i] === '' ? '>' : '> ' + lines[i])
      }
      return out.join('\n')
    }


    /**
     * Every quotable pick as one answer.
     *
     * One pick is one block, and a pick with a note is the passage followed
     * immediately by `我的回答：` and the note:
     *
     *     > 原文内容
     *     我的回答：批注内容。
     *
     *     > 另一段原文
     *     我的回答：xxxx
     *
     * The label is not decoration. A blockquote followed by a plain line is,
     * strictly, a **lazy continuation** of that quote, so without a marker the
     * note arrives at the model as more of its own text. `我的回答：` is what
     * makes the second line unambiguously the reader's — and it is why the note
     * needs no blank line before it: the label already breaks the ambiguity that
     * the blank line was there to break, and a tight block reads as one
     * question-and-answer rather than as two unrelated paragraphs.
     *
     * A pick with no note is the quote alone. 「标记」 is not here at all: it says
     * what the reader noticed, not what they want to say.
     */
    function buildAggregate(marks) {
      var blocks = exportBlocks(marks)
      if (blocks.length === 0) return ''
      var text = []
      for (var i = 0; i < blocks.length; i++) text.push(blocks[i].block)
      // A blank line between blocks, and one at the end so the sentence that
      // qualifies the whole set has somewhere to start.
      return text.join('\n\n') + '\n\n'
    }

    /**
     * The one block a pick contributes, exactly as the composer receives it.
     *
     * The block is the unit both exports and withdrawals speak in: it is what
     * one pick owns inside the draft, so taking a mark back can take exactly
     * this text out and nothing else.
     * @param {object} mark - one stored pick.
     * @returns {string} the quote, then the labelled note when there is one.
     */
    function blockOf(mark) {
      if (!quotedOf(mark)) return ''
      var text = typeof mark.text === 'string' ? mark.text : ''
      var body = text === '' ? unpackedFallback(mark) : text
      if (body === '') return ''
      var note = noteOf(mark).trim()
      var block = quoteBlock(tidyQuote(body))
      if (note !== '') block += '\n' + ANSWER_LABEL + note
      return block
    }

    /**
     * The picks of a set that produce a block, with their blocks, oldest first.
     * @param {Array} marks - the picks to hand over.
     * @returns {Array} `{id, block}` for every pick that contributes text.
     */
    function exportBlocks(marks) {
      var blocks = []
      for (var i = 0; i < marks.length; i++) {
        var block = blockOf(marks[i])
        if (block === '') continue
        blocks.push({ id: marks[i].id, block: block })
      }
      return blocks
    }

    /**
     * A mark made before this plugin kept verbatim text still has its
     * whitespace-free quote, which is a poor thing to type but better than
     * dropping the passage silently.
     */
    function unpackedFallback(mark) {
      return typeof mark.quote === 'string' ? mark.quote : ''
    }

    /**
     * Append text to the composer without stealing the keyboard.
     *
     * The shipped input face is used and nothing else. `captureInsertion()`
     * returns the draft selection together with the revision it belongs to, and
     * `insertText(text, span)` applies one undoable plain-text edit only while
     * that revision is still current. The caret therefore does not move, the
     * draft's own history gets one step, and no DOM inside the Lexical editor is
     * touched.
     *
     * There is deliberately no DOM fallback here. The old paste route existed
     * because 「引用并附注」 had to move the user's caret into the composer; this
     * flow never does, so a page without the input face simply has nowhere to
     * hand the set over — and saying nothing beats typing into an editor through
     * its back door.
     *
     * @param {string} text - the exact text to insert, newlines included.
     * @returns {boolean} whether the composer accepted it.
     */
    function appendToComposer(text) {
      if (text === '') return false
      var actions = shared.actions
      if (actions === null || typeof actions.insertText !== 'function') return false
      if (typeof actions.captureInsertion !== 'function') return false
      var span = null
      try {
        span = actions.captureInsertion()
      } catch (error) {
        return false
      }
      if (span === null || span === undefined) return false
      try {
        return actions.insertText(text, span) === true
      } catch (error) {
        return false
      }
    }

    /** The one newline a non-empty draft needs before an appended block. */
    function separatorFor(draft, block) {
      if (block === '') return ''
      if (draft === '') return block
      if (/\n$/.test(draft)) return draft + block
      return draft + '\n' + block
    }

    /**
     * The text 「汇总」 inserts: one chosen passage, a blank line, then the
     * reader's own words about it.
     *
     * Both halves are load-bearing. Without the `>` marker the model receives a
     * wall of its own prose with no way to tell which words are the answer and
     * which are the text being answered; without the blank line the note is a
     * *lazy continuation* of the quote and arrives as something the model said.
     *
     * Only annotated picks are handed over — see {@link buildAggregate} — and
     * the text ends with a blank line so the sentence that qualifies the whole
     * set has somewhere to start.
     */
    function composeAggregate(draft, marks) {
      // `buildAggregate` already ends the block with the blank line the next
      // sentence starts on; this only decides what separates it from whatever
      // the reader had typed.
      var body = buildAggregate(marks)
      if (body === '') return null
      return separatorFor(draft, body)
    }

    /**
     * The exact text one exported pick owns inside the draft.
     *
     * A record written by this version carries it verbatim (`exportedChunk`),
     * which is the only safe thing to search for: the draft's paragraphs are the
     * editor's, and re-deriving them from the mark could differ by a newline.
     * A record exported before that field existed is rebuilt from the pick, which
     * is still exact when the draft has not been edited since.
     * @param {object} mark - one stored pick.
     * @returns {string} the block plus its trailing blank line, or ''.
     */
    function chunkOf(mark) {
      if (mark === null || typeof mark !== 'object') return ''
      if (typeof mark.exportedChunk === 'string' && mark.exportedChunk !== '') {
        return mark.exportedChunk
      }
      var block = blockOf(mark)
      return block === '' ? '' : block + '\n\n'
    }

    /** Whether another mark from the same insert still shares the draft. */
    function batchHasOthers(sessionId, mark) {
      var marks = marksOf(sessionId)
      for (var i = 0; i < marks.length; i++) {
        var other = marks[i]
        if (other.id === mark.id) continue
        if (other.exportedAt === mark.exportedAt) return true
      }
      return false
    }

    /**
     * Take one pick's block back out of the composer.
     *
     * This is the one place the plugin removes text instead of adding it, and it
     * has to be conservative in a way an insert never is. The shipped input face
     * has no "delete a range": the only write that can shorten a draft is
     * `setDraft`, which rebuilds the whole editor from plain text. So a
     * withdrawal is done only when all of the following hold:
     *
     *   - the block is still there, byte for byte, trailing blank line included;
     *   - the draft has no reference chip (a rebuild would drop it);
     *   - the composer is not mid-submission;
     *   - the composer belongs to the Session the mark came from;
     *   - the text has not already been sent (an empty draft is a no-op).
     *
     * Anything else is refused rather than guessed. Removing the wrong lines
     * from someone's half-written message is worse than leaving a quote they
     * can delete by hand — and the caller says so on the card.
     *
     * @param {string} sessionId - the Session the mark belongs to.
     * @param {object} mark - the pick about to be forgotten.
     * @returns {{status: string, before?: string, after?: string}} `removed` when
     *   the draft was rewritten, `changed` when the block is gone or edited,
     *   `locked` when the draft cannot be rewritten safely, and `none` when
     *   there is nothing to do (never exported, or no composer on screen).
     */
    function withdrawComposerBlock(sessionId, mark) {
      var chunk = chunkOf(mark)
      if (chunk === '') return { status: 'none' }
      var actions = shared.actions
      var draft = shared.draft
      if (actions === null || typeof actions.setDraft !== 'function') return { status: 'none' }
      if (shared.sessionId !== sessionId) return { status: 'none' }
      if (typeof draft !== 'string' || draft === '') return { status: 'none' }
      if (shared.chips > 0) return { status: 'locked' }
      if (shared.phase !== null && shared.phase !== 'plain') return { status: 'locked' }

      var at = draft.indexOf(chunk)
      if (at === -1) return { status: 'changed' }

      var next = draft.slice(0, at) + draft.slice(at + chunk.length)
      // The newline the insert added before the batch's first block is ours
      // too: when the last block of that batch is the one being taken back and
      // it sits at the end of the draft, leaving the newline would make the
      // composer look non-empty to the next automatic insert.
      var atEnd = at + chunk.length === draft.length
      if (atEnd && mark.exportedLead === '\n' && !batchHasOthers(sessionId, mark)) {
        if (next.charAt(at - 1) === '\n') next = next.slice(0, at - 1) + next.slice(at)
      }

      try {
        actions.setDraft(next)
      } catch (error) {
        return { status: 'locked' }
      }
      // The bridge republishes on the next render; advance the parked draft now
      // so nothing in this tick still sees the block that was just removed.
      shared.draft = next
      return { status: 'removed', before: draft, after: next }
    }

    // ---------------------------------------------------------------------
    // the popup
    // ---------------------------------------------------------------------

    /**
     * The three calls the note box makes back into its component.
     *
     * The box is built by a plain function rather than by a component of its
     * own, so that the card and the box can share one placement effect and one
     * measurement; this is how that function reaches the component's state.
     */
    var actRef = { current: function () {} }
    var commitRef = { current: function () {} }
    var setNoteRef = { current: function () {} }
    var cancelRef = { current: function () {} }
    var quickRef = { current: function () {} }
    var undoRef = { current: function () {} }
    var inputRef = { current: null }

    /**
     * The composer's inner anchor. `aria-expanded` here is the shell's own
     * signal that a dropdown owns the keyboard — the same attribute the
     * composer's command menu sets while it is open.
     */
    var COMPOSER_ANCHOR_SELECTOR = '.dsh-composer-anchor'

    /** Distance the popup keeps from the viewport edges. */
    var EDGE = 8

    /** Distance the popup keeps from the text it quoted. */
    var GAP = 8

    function clamp(value, min, max) {
      if (max < min) return min
      return Math.min(Math.max(value, min), max)
    }

    var POPUP_BASE = {
      position: 'fixed',
      left: '0px',
      top: '0px',
      visibility: 'hidden',
      zIndex: 2147483000,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      borderRadius: '10px',
      border: '1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.12))',
      background: 'var(--dsw-alias-bg-overlay, #ffffff)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
      color: 'var(--dsw-alias-label-primary, #1a1a1a)',
      font: 'inherit',
      fontSize: '14px',
      lineHeight: '20px',
      pointerEvents: 'auto',
    }

    /**
     * The first layer is a column, not a strip.
     *
     * It used to be one row: a preview, 「标记」, 「引用并附注」 — and the reply
     * cost a second gesture, because the box that carries 同意/不同意 and the
     * input only existed one click deeper. Everything a reader can decide on a
     * passage is on this card now, so the card has to be tall enough to hold two
     * rows and stops trying to be a toolbar chip.
     */
    var POPUP_STYLE = Object.assign({}, POPUP_BASE, {
      boxSizing: 'border-box',
      flexDirection: 'column',
      alignItems: 'stretch',
      gap: '8px',
      width: '320px',
      padding: '10px 12px',
      fontSize: '15px',
      lineHeight: '22px',
      maxWidth: 'calc(100vw - 16px)',
    })

    /**
     * A passage that was already picked opens the smaller card: there is
     * nothing left to decide about it except whether to take the mark back.
     */
    var MARKED_POPUP_STYLE = Object.assign({}, POPUP_BASE, {
      padding: '4px 5px 4px 10px',
      userSelect: 'none',
      maxWidth: '440px',
    })

    /**
     * The small button that stands where the card will be.
     *
     * Only placement lives here: the chrome is in the stylesheet because the
     * hover state has to be a selector, and because a control whose opacity is
     * set inline cannot be faded up on hover. The offset is the same 12px the
     * card uses, which does two jobs — the pointer is never *on* the word when
     * it appears (so a hover means the reader moved there), and the card grows
     * out of the same corner the word occupied.
     */
    var PEEK_STYLE = {
      position: 'fixed',
      left: '0px',
      top: '0px',
      visibility: 'hidden',
      zIndex: 2147483000,
      pointerEvents: 'auto',
    }

    /** The row of quick answers and the one mark action beside them. */
    var CARD_ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: '0',
    }

    var BUTTON_BASE = {
      font: 'inherit',
      fontSize: '14px',
      lineHeight: '20px',
      padding: '5px 12px',
      borderRadius: '7px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      flex: '0 0 auto',
    }

    /**
     * 「标记」 is the default action and the one that answers nothing, so it
     * carries the fill: picking is what you came to do, and replying is one
     * exit from it.
     */
    var MARK_STYLE = Object.assign({}, BUTTON_BASE, {
      border: '1px solid rgba(220, 165, 0, 0.9)',
      background: 'rgba(255, 212, 64, 0.8)',
      color: '#1b1b1b',
    })

    var UNMARK_STYLE = Object.assign({}, BUTTON_BASE, {
      border: '1px solid var(--dsw-alias-state-error-primary, #f43146)',
      background: 'transparent',
      color: 'var(--dsw-alias-state-error-primary, #f43146)',
    })

    /**
     * The unmark result, and the one thing that can follow it.
     *
     * It reports rather than asks: the message says what happened to the draft,
     * and 「撤销」 appears only while there is a block to put back. Both are
     * quieter than the unmark button they replace — an outcome is not a choice.
     */
    var NOTICE_TEXT_STYLE = {
      flex: '0 1 auto',
      minWidth: '0',
      padding: '0 2px',
      fontSize: '13px',
      lineHeight: '18px',
      color: 'var(--dsw-alias-label-secondary, #666666)',
      whiteSpace: 'normal',
    }

    var NOTICE_UNDO_STYLE = Object.assign({}, BUTTON_BASE, {
      padding: '3px 10px',
      fontSize: '13px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.18))',
      background: 'transparent',
      color: 'var(--dsw-alias-brand-primary, #4d6bfe)',
    })

    // --- the note box ----------------------------------------------------

    // --- the insert button ------------------------------------------------

    /**
     * The one control this plugin puts in the composer: an icon button beside
     * the composer's own tools, in the same seat `dsh-genui` uses for its
     * prompt toggle.
     *
     * Geometry is copied from that button deliberately — same 28×28 box, same
     * 14px radius, same ghost styling and hover fill — so the two read as one
     * row of composer tools rather than as an add-on someone bolted on.
     */
    var INSERT_BUTTON_STYLE = {
      // Height matches the tool row's other button, but the width is the
      // content's: an icon alone fits 28, an icon plus a two-digit count does
      // not, and a fixed width would clip the count at 10.
      minWidth: '28px',
      height: '28px',
      padding: '0 8px',
      // A button that carries a number needs an edge, or it reads as stray text
      // sitting in the tool row rather than as a control with a state.
      border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.18))',
      boxSizing: 'border-box',
      borderRadius: '14px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '3px',
      font: 'inherit',
      whiteSpace: 'nowrap',
    }

    /**
     * The resting state for a button with nothing to do. It stays legible and
     * stays in place: a control that vanishes teaches nothing, and one that
     * turns invisible reads as broken.
     */
    var INSERT_BUTTON_IDLE_STYLE = {
      color: 'var(--dsw-alias-label-tertiary, #999999)',
      cursor: 'default',
    }

    /**
     * The count's pulse.
     *
     * Scoped to the number, not the button: what changed is the count, and the
     * motion points at the thing that moved. Scaling the whole button would
     * shake the verb too, which did not change and is not the news.
     *
     * It runs once per increment, in both themes, and it is short enough not to
     * delay a click that follows it. `prefers-reduced-motion` is honoured,
     * because a pulse whose whole job is to draw the eye is exactly the kind of
     * motion that setting exists to stop.
     */
    var PULSE_CSS =
      '@keyframes dsh-select-consent-pulse{' +
      '0%{transform:scale(1)}' +
      '35%{transform:scale(1.55)}' +
      '100%{transform:scale(1)}' +
      '}' +
      '[data-select-consent-insert][data-pulse="true"] .dsh-select-consent-count{' +
      'display:inline-block;' +
      'animation:dsh-select-consent-pulse 420ms ease-out;' +
      '}' +
      '@media (prefers-reduced-motion: reduce){' +
      '[data-select-consent-insert][data-pulse="true"] .dsh-select-consent-count{' +
      'animation:none}' +
      '}'

    /** The verb, which is the part that says what pressing does. */
    var INSERT_VERB_STYLE = {
      // Halfway between the count's 11px and the tool row's own label size, so
      // the two halves of the label read as one phrase rather than as two.
      fontSize: '12px',
      lineHeight: '1',
    }

    /** The count, sitting beside the verb inside the button. */
    var INSERT_COUNT_STYLE = {
      fontSize: '12px',
      lineHeight: '1',
      fontWeight: '600',
      fontVariantNumeric: 'tabular-nums',
      display: 'inline-block',
    }

    /**
     * The switch beside the insert button.
     *
     * It shows its state as a filled or hollow dot rather than only in a
     * tooltip: a mode the reader cannot see is a mode they will forget they set.
     */
    var AUTO_SWITCH_STYLE = {
      height: '28px',
      padding: '0 8px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.18))',
      boxSizing: 'border-box',
      borderRadius: '14px',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '1',
      whiteSpace: 'nowrap',
    }

    /** The dot: hollow when off, filled with the brand colour when on. */
    var AUTO_DOT_STYLE = {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      boxSizing: 'border-box',
      flex: '0 0 auto',
    }

    /** The hover bubble. Fixed and portalled, so no composer clip can cut it. */
    var INSERT_TOOLTIP_STYLE = {
      position: 'fixed',
      transform: 'translate(-50%, -100%)',
      zIndex: 2147483000,
      padding: '4px 8px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-overlay, #ffffff)',
      color: 'var(--dsw-alias-label-primary, #1a1a1a)',
      fontSize: '12px',
      lineHeight: '18px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
    }

    /**
     * The popup, and the owner of every mark in the page.
     *
     * It listens on the document for a finished selection, places itself
     * against the quoted text, writes the composer through the bridge, and —
     * for the transcript — keeps the highlight registry in step with the marks
     * of the current Session.
     * @param {object} props - the overlay's standard props plus `t`.
     * @returns {object} the stylesheet, and the card while one is open.
     */
    function ConsentPopup(props) {
      var t = props.t
      var opened = React.useState(null)
      var scene = opened[0]
      var setScene = opened[1]

      // Bumped when the bridge publishes a new Session.
      var bumped = React.useState(0)
      var version = bumped[0]
      var setVersion = bumped[1]

      var rootRef = React.useRef(null)
      // The signature of the card currently on screen, so the entrance animation
      // can tell "a new card opened" from "the same card re-rendered".
      var enteredRef = React.useRef(null)
      // Listeners are mounted once, so they read the scene through a ref
      // rather than through a stale closure.
      var sceneRef = React.useRef(null)
      var lastSelectionRef = React.useRef(null)
      sceneRef.current = scene
      // The note box's textarea, and the key it has already been focused under
      // so a re-render never steals the caret back to the end.
      var focusKeyRef = React.useRef(null)
      // The currently painted marks, and the hit-test set for unmarking.
      var derivedRef = React.useRef([])
      var refreshRef = React.useRef(null)

      React.useEffect(
        function () {
          function onChange() {
            setVersion(function (n) {
              return n + 1
            })
          }
          watchers.push(onChange)
          return function () {
            var at = watchers.indexOf(onChange)
            if (at !== -1) watchers.splice(at, 1)
          }
        },
        []
      )

      // One observer for the component's lifetime. It is deliberately not
      // re-created when the draft changes: typing republishes the bridge on
      // every keystroke, and tearing the observer down each time would both
      // churn and lose the mutations that arrived in between.
      React.useEffect(
        function () {
          var frame = null
          var timer = null

          function refresh() {
            frame = null
            var sessionId = currentSessionId()
            derivedRef.current = deriveMarks(sessionId, marksOf(sessionId))
          }

          function schedule() {
            if (frame !== null) return
            frame = window.requestAnimationFrame(refresh)
          }

          function scheduleSoon() {
            if (timer !== null) window.clearTimeout(timer)
            timer = window.setTimeout(schedule, 200)
          }

          refreshRef.current = refresh

          // Paging, a streaming answer and a Session switch all replace the
          // nodes a mark is anchored in, so the ranges are rebuilt from the
          // anchors rather than kept.
          var observer = null
          try {
            observer = new MutationObserver(scheduleSoon)
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              characterData: true,
            })
          } catch (error) {
            observer = null
          }

          document.addEventListener('scroll', schedule, true)
          window.addEventListener('resize', schedule)

          return function () {
            if (frame !== null) window.cancelAnimationFrame(frame)
            if (timer !== null) window.clearTimeout(timer)
            if (observer !== null) observer.disconnect()
            clearPreviewMark()
            document.removeEventListener('scroll', schedule, true)
            window.removeEventListener('resize', schedule)
            refreshRef.current = null
            derivedRef.current = []
            var registry = highlightRegistry()
            if (registry !== null) {
              try {
                registry.delete(HIGHLIGHT_NAME)
              } catch (error) {
                /* Nothing painted is nothing to remove. */
              }
            }
          }
        },
        []
      )

      // A new Session carries a different set of marks.
      React.useEffect(
        function () {
          if (refreshRef.current !== null) refreshRef.current()
        },
        [version]
      )

      /** Resolve the current DOM Range for a stable transcript anchor. */
      function rangeOfAnchor(anchor) {
        if (anchor === null || anchor === undefined) return null
        var elements = document.querySelectorAll(ANCHOR_SELECTOR)
        for (var i = 0; i < elements.length; i++) {
          if (elements[i].getAttribute('data-chat-anchor-key') !== anchor.key) continue
          var full = packedMapOf(elements[i])
          var span = locate(full, anchor)
          if (span === null) continue
          var range = rangeFromIndices(full, span.start, span.end)
          if (range !== null) return range
        }
        return null
      }

      /** The rect a note box should hang off: the passage it is about. */
      function selectionBoxOf(anchor) {
        var range = rangeOfAnchor(anchor)
        return range === null ? null : boxOf(range)
      }

      /** Paint a provisional selection separately from durable marks. */
      function setPreviewMark(anchor) {
        var registry = highlightRegistry()
        var range = rangeOfAnchor(anchor)
        if (registry === null || range === null) return
        try {
          registry.set(PREVIEW_HIGHLIGHT_NAME, new window.Highlight(range))
        } catch (error) {
          /* The note box still works where custom highlights are unavailable. */
        }
      }

      /** Remove only the note box's provisional highlight. */
      function clearPreviewMark() {
        var registry = highlightRegistry()
        if (registry === null) return
        try {
          registry.delete(PREVIEW_HIGHLIGHT_NAME)
        } catch (error) {
          /* A missing preview is already clear. */
        }
      }

      // --- the consent gate -------------------------------------------------
      //
      // Two timers, one record: `hover` is the pointer resting on the button,
      // and `life` is how long an untouched button is allowed to sit there.
      // They live in a ref because the listeners are mounted once and would
      // otherwise close over the state of the first render.
      var peekRef = React.useRef(null)
      if (peekRef.current === null) {
        peekRef.current = { hover: null, life: null }
      }
      var peek = peekRef.current

      function stopPeekTimer(name) {
        var handle = peek[name]
        if (handle === null) return
        window.clearTimeout(handle)
        peek[name] = null
      }

      function stopPeekTimers() {
        stopPeekTimer('hover')
        stopPeekTimer('life')
      }

      /**
       * Open a scene whose subject is already on the page.
       *
       * The compact card for a passage that carries a mark hangs off that
       * passage's own rect: the reader clicked words, not a release point, so
       * there is no cursor to place it beside. This also keeps the card alive
       * across the click that opened it — a marked scene owns no selection and
       * therefore survives the collapse that follows.
       * @param {object} box - the passage's rect.
       * @param {object} scene - the scene to open.
       */
      function openWith(box, scene) {
        setScene(Object.assign({}, scene, { box: box }))
      }

      /**
       * Draw the button for a finished selection.
       *
       * Nothing is painted into the page here, and nothing takes focus: the
       * browser's own selection already says which words these are, and the
       * point of a 32px circle is that a reader who did not mean to select can
       * still ignore it. The pop and halo are the control introducing itself;
       * the durable highlight waits for a gesture that means yes.
       */
      function openPeek(found, x, y) {
        setScene({
          box: found.box,
          cursor: { x: x, y: y },
          kind: 'peek',
          text: found.text,
          anchor: found.anchor,
          editing: null,
          note: '',
        })
        stopPeekTimer('life')
        peek.life = window.setTimeout(function () {
          peek.life = null
          var current = sceneRef.current
          if (current !== null && current.kind === 'peek') setScene(null)
        }, PEEK_LIFE_MS)
      }

      /**
       * Turn the button into the card.
       *
       * Both doors — a click and a 160ms hover — land here, and both take the
       * caret: the card exists to be answered, so the field is where the next
       * keystroke belongs. That is also why the passage is pinned here: an
       * unfocused browser selection greys out, and the card's subject would
       * disappear exactly when the reader starts to answer it.
       */
      function expandPeek() {
        var current = sceneRef.current
        if (current === null || current.kind !== 'peek') return
        stopPeekTimer('hover')
        stopPeekTimer('life')
        var anchor = current.anchor
        if (anchor !== null && anchor !== undefined) {
          lastSelectionRef.current = { box: current.box, text: current.text, anchor: anchor }
          setPreviewMark(anchor)
        }
        setScene({
          box: current.box,
          cursor: current.cursor,
          kind: 'agree',
          text: current.text,
          anchor: anchor,
          editing: null,
          note: '',
        })
      }

      /** The pointer has come to rest on the button: open the card and take the caret. */
      function peekHoverIn() {
        var current = sceneRef.current
        if (current === null || current.kind !== 'peek') return
        stopPeekTimer('hover')
        peek.hover = window.setTimeout(function () {
          peek.hover = null
          expandPeek()
        }, PEEK_HOVER_MS)
      }

      /** It was only passing through. */
      function peekHoverOut() {
        stopPeekTimer('hover')
      }

      // --- selection, clicks and dismissal ---------------------------------
      React.useEffect(function () {
        var timer = null
        var doubleClickTimer = null

        function hide() {
          stopPeekTimers()
          if (sceneRef.current !== null) setScene(null)
        }

        function onMouseUp(event) {
          if (event.button !== 0) return
          var popup = rootRef.current
          if (popup !== null && popup.contains(event.target)) return
          if (timer !== null) window.clearTimeout(timer)
          var x = event.clientX
          var y = event.clientY

          // The selection is not final until the event's own default has run.
          timer = window.setTimeout(function () {
            timer = null
            var found = readSelection()
            if (found !== null) {
              // Straight away. A button that arrives late reads as a stray
              // artefact appearing from nowhere; one that arrives with the
              // mouse-up reads as part of the gesture. Nothing is committed
              // here — no focus, no paint, nothing stored — so being early
              // costs the reader nothing but a 32px circle.
              openPeek(found, x, y)
              return
            }
            // A click with nothing selected may be a click on a mark.
            var hit = markAtPoint(derivedRef.current, x, y)
            if (hit !== null) {
              openWith(boxOf(hit.range), {
                kind: 'marked',
                text: typeof hit.mark.text === 'string' ? hit.mark.text : hit.mark.quote,
                mark: hit.mark,
                sessionId: hit.sessionId,
              })
            }
          }, 0)
        }

        function onMouseDown(event) {
          var popup = rootRef.current
          if (popup !== null && popup.contains(event.target)) return
          var current = sceneRef.current
          if (current !== null && current.kind === 'peek') {
            // The button was never a form: there is no sentence to keep and
            // nothing to close deliberately.
            hide()
            return
          }
          if (current !== null && current.kind !== 'marked') {
            // Clicking away from a card with words in it keeps them: the reader
            // wrote a sentence and moved on, and silently dropping it would be
            // the worst thing this plugin could do. A card that is still empty
            // is closed as if it had never been opened.
            var note = typeof current.note === 'string' ? current.note : ''
            if (note.trim() !== '') commitRef.current()
            else cancelNote()
            return
          }
          hide()
        }

        // Some transcript renderers collapse the selection after the second
        // mouse-up in a double-click sequence. Read it again on `dblclick`, after
        // the browser has finalized the word selection, and reopen the same
        // action card (never jump directly into the note box).
        function onDoubleClick(event) {
          if (doubleClickTimer !== null) window.clearTimeout(doubleClickTimer)
          var x = event.clientX
          var y = event.clientY
          doubleClickTimer = window.setTimeout(function () {
            doubleClickTimer = null
            var found = readSelection()
            // Some transcript handlers collapse the browser selection after the
            // native double-click. Re-select the word under the pointer as a
            // fallback; readSelection still rejects inputs, modals and the popup.
            if (found === null) {
              try {
                var range = typeof document.caretRangeFromPoint === 'function'
                  ? document.caretRangeFromPoint(x, y)
                  : null
                if (range === null && typeof document.caretPositionFromPoint === 'function') {
                  var position = document.caretPositionFromPoint(x, y)
                  if (position !== null) {
                    range = document.createRange()
                    range.setStart(position.offsetNode, position.offset)
                    range.collapse(true)
                  }
                }
                var selection = window.getSelection()
                if (range !== null && selection !== null) {
                  selection.removeAllRanges()
                  selection.addRange(range)
                  if (typeof selection.modify === 'function') {
                    selection.collapse(range.startContainer, range.startOffset)
                    selection.modify('move', 'backward', 'word')
                    selection.modify('extend', 'forward', 'word')
                  } else if (typeof range.expand === 'function') {
                    range.expand('word')
                    selection.removeAllRanges()
                    selection.addRange(range)
                  }
                  found = readSelection()
                }
              } catch (error) {
                found = null
              }
            }
            if (found === null) return
            openPeek(found, x, y)
          }, 0)
        }

        function onKeyDown(event) {
          var current = sceneRef.current

          if (event.key === 'Escape') {
            if (current !== null && current.kind === 'peek') {
              // The word was never a decision, so leaving it costs nothing and
              // must not jump the caret anywhere.
              hide()
              return
            }
            if (current !== null && current.kind !== 'marked') {
              // Escape leaves without storing, and without taking back a mark
              // that was already there: opening a card about a passage is not
              // the same gesture as picking it.
              cancelNote()
              return
            }
            hide()
            return
          }

          // Typing means the reader went back to writing. Enter, Space and Tab
          // are how the button is reached by keyboard, so they pass.
          if (current !== null && current.kind === 'peek') {
            if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') return
            hide()
            return
          }

        }

        function onCopy() {
          // Copying is the clearest "I only wanted the text" there is.
          var current = sceneRef.current
          if (current !== null && current.kind === 'peek') hide()
        }

        function onSelectionChange() {
          var selection = window.getSelection()
          if (selection !== null && !selection.isCollapsed) return
          // A collapsed selection is how the other scenes look, so this must not
          // be the handler that closes them.
          //
          //   a click on a mark   the mouse-up handler decides, and it needs the
          //                       card alive to be asked.
          //   the answer card     answering it collapses the page's selection —
          //                       that is a side effect of the click, not a
          //                       decision to leave. Without this exemption the
          //                       card opens and is hidden in the same tick, which
          //                       reads as "the button does nothing at all".
          //
          // The button is the exception: it exists only for a selection, so a
          // selection that is gone takes it with it.
          var current = sceneRef.current
          if (current !== null && current.kind === 'peek') {
            hide()
            return
          }
          if (current !== null) return
          hide()
        }

        function onViewportChange() {
          // The answer card is a small form, not a toolbar chip: it is the one
          // scene that survives the transcript moving under it, because it is
          // the scene the reader is typing in. The button is tied to where it
          // was dropped, so it closes.
          var current = sceneRef.current
          if (current !== null && current.kind === 'agree') return
          hide()
        }

        document.addEventListener('mouseup', onMouseUp, true)
        document.addEventListener('mousedown', onMouseDown, true)
        document.addEventListener('dblclick', onDoubleClick, true)
        document.addEventListener('keydown', onKeyDown, true)
        document.addEventListener('copy', onCopy, true)
        document.addEventListener('selectionchange', onSelectionChange)
        window.addEventListener('scroll', onViewportChange, true)
        window.addEventListener('resize', onViewportChange)

        return function () {
          if (timer !== null) window.clearTimeout(timer)
          if (doubleClickTimer !== null) window.clearTimeout(doubleClickTimer)
          stopPeekTimers()
          document.removeEventListener('mouseup', onMouseUp, true)
          document.removeEventListener('mousedown', onMouseDown, true)
          document.removeEventListener('dblclick', onDoubleClick, true)
          document.removeEventListener('keydown', onKeyDown, true)
          document.removeEventListener('copy', onCopy, true)
          document.removeEventListener('selectionchange', onSelectionChange)
          window.removeEventListener('scroll', onViewportChange, true)
          window.removeEventListener('resize', onViewportChange)
        }
      }, [])

      // Place the popup by the actual release point, not the middle of a wide
      // selection. If that corner is short of room, flip to the other side and
      // clamp to the viewport.
      React.useLayoutEffect(
        function () {
          var node = rootRef.current
          if (scene === null || node === null) {
            // Closed: forget what was shown, so reopening the same passage still
            // animates instead of appearing with a stale signature.
            enteredRef.current = null
            return
          }
          var self = boxOf(node)
          var anchor = scene.box
          anchor = anchor === null || anchor === undefined ? boxOf(document.body) : anchor
          var cursor = scene.cursor
          var left
          var top
          if (cursor && typeof cursor.x === 'number' && typeof cursor.y === 'number') {
            var offset = 12
            left = cursor.x + offset
            if (left + self.width > window.innerWidth - EDGE) left = cursor.x - self.width - offset
            top = cursor.y + offset
            if (top + self.height > window.innerHeight - EDGE) top = cursor.y - self.height - offset
          } else {
            left = anchor.right - self.width
            top = anchor.bottom + GAP
            if (top + self.height > window.innerHeight - EDGE) top = anchor.top - self.height - GAP
          }
          left = clamp(left, EDGE, Math.max(EDGE, window.innerWidth - self.width - EDGE))
          top = clamp(top, EDGE, Math.max(EDGE, window.innerHeight - self.height - EDGE))
          node.style.left = Math.round(left) + 'px'
          node.style.top = Math.round(top) + 'px'
          node.style.visibility = 'visible'

          // Animate the entrance once per opening, not once per render.
          //
          // `scene` is replaced on every keystroke in the note box (the value is
          // controlled), so keying the animation on it would replay the entrance
          // while the reader types — the opposite of smooth. The signature below
          // ignores the note text: it changes when a *new* card opens, and stays
          // put while the same card is being filled in.
          var signature =
            String(scene.kind) +
            '|' +
            String(scene.editing === null || scene.editing === undefined ? '' : scene.editing) +
            '|' +
            String(scene.anchor === null || scene.anchor === undefined ? '' : scene.anchor.key) +
            '|' +
            String(scene.anchor === null || scene.anchor === undefined ? '' : scene.anchor.index) +
            '|' +
            String(scene.box === null || scene.box === undefined ? '' : scene.box.left) +
            '|' +
            String(scene.box === null || scene.box === undefined ? '' : scene.box.top)
          if (enteredRef.current !== signature) {
            enteredRef.current = signature
            // Remove, force a style recalculation, then re-add: without the
            // reflow the browser sees no change and keeps the finished animation.
            node.removeAttribute('data-enter')
            void node.offsetWidth
            node.setAttribute('data-enter', 'true')
          }
        },
        [scene]
      )

      /**
       * Do the thing the open card offers, then close or report.
       *
       * 「标记」 only writes a mark. 「取消标记」 is the one action that can write
       * the composer: when the pick was already handed over, the block it owns
       * in the draft is taken back out (see `withdrawComposerBlock`), and the
       * card stays for a moment to say so — or to say why it could not, and to
       * offer the undo the editor's own history cannot guarantee.
       * @param {string} mode - 'mark' | 'unmark'.
       */
      function act(mode) {
        var current = sceneRef.current
        if (current === null) return

        if (mode === 'unmark') {
          var sessionId = current.sessionId || currentSessionId()
          var mark = current.mark
          var outcome = withdrawComposerBlock(sessionId, mark)
          removeMark(sessionId, mark.id)
          marksChanged()
          if (outcome.status === 'removed') {
            setScene({
              box: current.box,
              cursor: current.cursor,
              kind: 'marked',
              text: current.text,
              mark: mark,
              sessionId: sessionId,
              notice: {
                message: t('unmarkRemoved'),
                undo: {
                  sessionId: sessionId,
                  mark: mark,
                  before: outcome.before,
                  after: outcome.after,
                },
              },
            })
            return
          }
          if (outcome.status === 'changed' || outcome.status === 'locked') {
            setScene({
              box: current.box,
              cursor: current.cursor,
              kind: 'marked',
              text: current.text,
              mark: mark,
              sessionId: sessionId,
              notice: {
                message: outcome.status === 'changed' ? t('unmarkEdited') : t('unmarkLocked'),
                undo: null,
              },
            })
            return
          }
          setScene(null)
          return
        }

        if (!hasAnchorOf(current)) {
          setScene(null)
          return
        }

        // 「标记」 needs no sentence and closes the card immediately. Quoting a
        // passage without one is the same card's input, answered with nothing.
        if (mode === 'mark') {
          setScene(null)
          clearPreviewMark()
          writeMark(current.anchor, '', false)
        }
      }

      /**
       * Put back what 「取消标记」 just took away.
       *
       * The draft is restored only while it is still exactly what the removal
       * wrote: if the reader has typed since, restoring the old text would
       * overwrite words they own, so the mark is not put back either — the card
       * closes and the removal stands.
       */
      function undoUnmark() {
        var current = sceneRef.current
        if (current === null || current.notice === undefined || current.notice === null) return
        var undo = current.notice.undo
        if (undo === null || undo === undefined) return
        setScene(null)
        if (typeof shared.draft !== 'string' || shared.draft !== undo.after) return
        if (shared.actions === null || typeof shared.actions.setDraft !== 'function') return
        try {
          shared.actions.setDraft(undo.before)
        } catch (error) {
          return
        }
        shared.draft = undo.before
        restoreMark(undo.sessionId, undo.mark)
        marksChanged()
      }

      /** Whether a scene's selection has somewhere durable to write. */
      function hasAnchorOf(current) {
        return current.anchor !== null && current.anchor !== undefined
      }

      /**
       * Record one anchor and repaint, resolving whose Session it belongs to.
       * @returns {object|null} the stored mark, so a box can bind to it.
       */
      function writeMark(anchor, note, quoted) {
        var stored = addMark(
          typeof anchor.sessionId === 'string' ? anchor.sessionId : currentSessionId(),
          anchor,
          note,
          quoted
        )
        marksChanged()
        return stored
      }

      /**
       * Commit the note box: store what was typed, in whichever mode opened it.
       *
       * An empty box is not an error and not a silent nothing: in creating mode
       * it degrades to the pick it always was, and in binding mode it clears the
       * note that was there.
       *
       * @param {string} [override] - the note to store instead of the field's own
       *   text, which is what a quick answer commits.
       */
      function commitNote(override) {
        var current = sceneRef.current
        if (current === null || current.kind === 'marked') return
        var note =
          typeof override === 'string'
            ? override
            : typeof current.note === 'string'
              ? current.note
              : ''
        setScene(null)
        // Committing stores a mark of its own (or leaves none); the provisional
        // highlight must never outlive the card either way.
        clearPreviewMark()
        var sessionId = currentSessionId()
        if (current.editing === null || current.editing === undefined) {
          // The highlight only becomes a durable quoted mark if the reader adds
          // an answer. An empty submit leaves no stored mark or highlight.
          if (note.trim() !== '') {
            writeMark(current.anchor, note, true)
            return
          }
          if (currentSessionId() !== null) refreshRef.current && refreshRef.current()
          return
        }
        setMarkNote(sessionId, current.editing, note)
        marksChanged()
      }

      /**
       * Answer the passage in one click: store the answer as if it had been
       * typed and confirmed.
       *
       * The answer is committed straight away rather than staged in the field,
       * because a quick answer exists to skip the second step — leaving it for
       * another Enter would be the slow path with extra buttons. This is the
       * same exit as typing it: the pick is still a quotation, the composer is
       * still untouched, and 「填入」 still does the handing over.
       *
       * The field is not discarded by the click. If the reader wrote something
       * first, the answer becomes the first line and their words follow it on
       * the next line — one note, both halves, in the order they said them.
       * When the typed text already opens with the answer (「同意，但…」), saying
       * it twice adds nothing, so the typed sentence stands on its own.
       * @param {string} answer - the note to store, already translated.
       */
      function quickNote(answer) {
        var current = sceneRef.current
        if (current === null || current.kind === 'marked') return
        var typed = typeof current.note === 'string' ? current.note.trim() : ''
        if (typed === '' || typed === answer || typed.indexOf(answer) === 0) {
          commitNote(typed === '' ? answer : typed)
          return
        }
        commitNote(answer + '\n' + typed)
      }

      /**
       * Leave the card without committing.
       *
       * Nothing is stored and nothing is taken back. A card that was opened but
       * never committed wrote nothing, so there is nothing to undo; and a mark
       * that already existed belongs to an earlier gesture, so this must not
       * remove it. Marking is taken back where it was made: by clicking the
       * marked passage and choosing 「取消标记」.
       */
      function cancelNote() {
        var current = sceneRef.current
        if (current === null || current.kind === 'marked') return
        setScene(null)
        // The provisional highlight goes with the card; any durable mark stays.
        clearPreviewMark()
        if (refreshRef.current !== null) refreshRef.current()
        // Quietly: this focus is the plugin's own doing, not the reader
        // arriving to write, so it must not trigger an auto-insert of the set
        // they just walked away from.
        focusComposerQuietly()
      }

      /**
       * While a layer that owns the keyboard is open, tell the composer that a
       * dropdown owns it.
       *
       * The composer binds `aria-expanded` on its inner anchor and suspends
       * send-on-Enter while a popup of its own is open. This card is the
       * shell's popup, not the composer's, so without this the Enter that closes
       * it would also send the message it was riding on: one keystroke, two
       * actions. The answer layer always holds a field, so it always counts.
       */
      var boxOpen = scene !== null && scene.kind === 'agree'
      React.useEffect(
        function () {
          if (!boxOpen) return undefined
          var anchor = document.querySelector(COMPOSER_ANCHOR_SELECTOR)
          if (anchor === null) return undefined
          var before = anchor.getAttribute('aria-expanded')
          anchor.setAttribute('aria-expanded', 'true')
          return function () {
            if (before === null) anchor.removeAttribute('aria-expanded')
            else anchor.setAttribute('aria-expanded', before)
          }
        },
        [boxOpen]
      )

      /**
       * Put the caret in the field, once per opening, and never again.
       *
       * The reader asked for a sentence, not for a textarea they then have to
       * click, so the field takes focus itself. It must not take focus on every
       * keystroke, though — the value is controlled, and re-focusing each time
       * the state came back would drag the caret to the end while typing. So the
       * focus is keyed to the field's *identity*: a new set of passage, a new
       * focus; the same one, hands off.
       */
      var boxKey =
        scene !== null && scene.kind === 'agree'
          ? 'note:' +
            String(scene.anchor === null || scene.anchor === undefined ? '' : scene.anchor.key) +
            ':' +
            String(scene.anchor === null || scene.anchor === undefined ? '' : scene.anchor.index)
          : null
      React.useEffect(
        function () {
          if (boxKey === null) {
            focusKeyRef.current = null
            return undefined
          }
          if (focusKeyRef.current === boxKey) return undefined
          var node = inputRef.current
          if (node === null) return undefined
          focusKeyRef.current = boxKey
          try {
            node.focus({ preventScroll: true })
            var note = sceneRef.current === null ? '' : sceneRef.current.note
            if (typeof node.setSelectionRange === 'function') {
              var at = String(note === undefined || note === null ? '' : note).length
              node.setSelectionRange(at, at)
            }
          } catch (error) {
            /* A box that cannot take focus is still a box that can be clicked. */
          }
          return undefined
        },
        [boxKey]
      )

      // The unmark result is a report, not a decision: it leaves on its own so a
      // card that is only saying "done" never has to be dismissed.
      var noticeLive =
        scene !== null && scene.notice !== undefined && scene.notice !== null
      React.useEffect(
        function () {
          if (!noticeLive) return undefined
          var shown = scene
          var life =
            shown.notice.undo === null || shown.notice.undo === undefined
              ? NOTICE_LIFE_MS
              : NOTICE_UNDO_MS
          var handle = window.setTimeout(function () {
            if (sceneRef.current === shown) setScene(null)
          }, life)
          return function () {
            window.clearTimeout(handle)
          }
        },
        [noticeLive, scene]
      )

      // The popup's chrome is built by plain functions so the card and the box
      // can share one placement effect; this is the one line that lets them
      // reach the component's own state.
      actRef.current = act
      commitRef.current = commitNote
      cancelRef.current = cancelNote
      quickRef.current = quickNote
      undoRef.current = undoUnmark
      setNoteRef.current = function (next) {
        var current = sceneRef.current
        if (current === null || current.kind !== 'agree') return
        // A controlled textarea: the scene is the value, so a keystroke is a
        // state write and the caret stays where the browser put it.
        setScene(Object.assign({}, current, { note: next }))
      }

      if (scene === null) {
        return React.createElement(React.Fragment, null, styleElement())
      }

      if (scene.kind === 'peek') {
        // The peek control. It is a button so a keyboard can reach it, and it is
        // drawn 12px away from the release point so the pointer is never already
        // on it — a hover therefore means the reader moved there on purpose.
        // The chrome lives in the stylesheet (it has a hover state); only the
        // placement is inline.
        return React.createElement(
          React.Fragment,
          null,
          styleElement(),
          React.createElement(
            'button',
            {
              ref: rootRef,
              type: 'button',
              'data-select-consent-peek': 'true',
              'aria-label': t('peek'),
              title: t('peekTitle'),
              style: PEEK_STYLE,
              onMouseEnter: peekHoverIn,
              onMouseLeave: peekHoverOut,
              // Keep the page's selection: the card about to open has that
              // passage as its subject, and a mousedown would collapse it.
              onMouseDown: function (event) {
                event.preventDefault()
              },
              onClick: function (event) {
                event.preventDefault()
                expandPeek()
              },
            },
            peekIcon()
          )
        )
      }

      var marked = scene.kind === 'marked'
      var notice = marked && scene.notice !== undefined && scene.notice !== null
      // The card carries the answers and the input, so it takes the caret and
      // has to keep the page selection alive around it. The compact marked card
      // is still a chip: it must not steal focus or the selection.
      var inputLayer = !marked
      return React.createElement(
        React.Fragment,
        null,
        styleElement(),
        React.createElement(
          'div',
          {
            ref: rootRef,
            role: notice ? 'status' : marked ? 'toolbar' : 'group',
            'aria-label': notice
              ? scene.notice.message
              : marked
                ? t('markedToolbar')
                : t('toolbarAnnotate'),
            'data-select-consent-popup': 'true',
            style: marked ? MARKED_POPUP_STYLE : POPUP_STYLE,
            // Keep the page's own selection, and therefore the text the user
            // picked, from being thrown away by the click that answers it.
            // A layer that holds the input is the exception: it has to be
            // clickable to be typed in.
            onMouseDown: inputLayer
              ? undefined
              : function (event) {
                  event.preventDefault()
                },
          },
          notice
            ? noticeCard(scene, t)
            : marked
              ? cardChrome(scene, marked, t)
              : answerLayer(scene, t)
        )
      )
    }

    /**
     * The peek button's glyph: a speech bubble, drawn rather than typed.
     *
     * A bubble is the one mark for "say something about this" that still reads
     * at 18px, and it shares no shape with 「标记」 inside the card, so the two
     * never look like the same control. It is `aria-hidden` because
     * the button carries a label — a screen reader announcing a drawing would
     * be reading the picture instead of the verb.
     * @returns {object} the icon element.
     */
    function peekIcon() {
      return React.createElement(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        React.createElement('path', {
          d: 'M13.4 7.9c0 2.7-2.4 4.9-5.4 4.9-.9 0-1.7-.2-2.4-.5l-3 1 .8-2.6a4.6 4.6 0 0 1-.8-2.8C2.6 5.2 5 3 8 3s5.4 2.2 5.4 4.9Z',
        })
      )
    }

    /**
     * The card: the two answers, the mark action, and the custom input — every
     * choice a passage can be answered with, in one layer.
     *
     * 「标记」 shares the answer row because it is the same kind of decision as
     * the other two ("this one, but nothing to say"), while the input is a
     * slower path to the same quotation and gets the full second row.
     * @param {object} scene - the open card's state.
     * @param {function(string, object=): string} t - the translate function.
     * @returns {object} the card.
     */
    function answerLayer(scene, t) {
      return React.createElement(
        'div',
        { key: 'card', className: 'dsh-select-consent-stack' },
        React.createElement(
          'div',
          { key: 'answers', style: CARD_ROW_STYLE },
          // Agree first, disagree second. The affirmative is the answer a
          // reader reaches for most often, so it sits where the eye lands
          // first; the negative follows rather than leading the row.
          quickButton('agree', t('agree'), t('agreeEmoji')),
          quickButton('disagree', t('disagree'), t('disagreeEmoji')),
          React.createElement(
            'button',
            {
              key: 'mark',
              type: 'button',
              title: t('markTitle'),
              style: MARK_STYLE,
              onClick: function () {
                actRef.current('mark')
              },
            },
            t('mark')
          )
        ),
        noteInput(scene, t)
      )
    }

    /**
     * One answer button: an emoji for the eye, the plain answer for the record.
     *
     * The emoji is `aria-hidden` and the stored note is the label alone, so what
     * reaches the model is 「同意」 rather than 「👍 同意」 — the emoji is how the
     * card is scanned, not what is said.
     */
    function quickButton(key, label, emoji) {
      return React.createElement(
        'button',
        {
          key: key,
          type: 'button',
          'aria-label': label,
          'data-answer': label,
          className:
            'dsh-select-consent-quick dsh-select-consent-quick--' +
            (key === 'agree' ? 'agree' : 'disagree'),
          onClick: function () {
            quickRef.current(label)
          },
        },
        React.createElement(
          'span',
          { className: 'dsh-select-consent-emoji', 'aria-hidden': 'true' },
          emoji
        ),
        React.createElement('span', null, label)
      )
    }

    /**
     * The custom input. It is a textarea so the browser's own IME, undo and
     * selection behaviour apply; Enter commits, Shift+Enter breaks the line,
     * Escape cancels.
     */
    function noteInput(scene, t) {
      var onInput = function (event) {
        setNoteRef.current(event.target.value)
      }
      var onKeyDown = function (event) {
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing) {
          event.preventDefault()
          commitRef.current()
          return
        }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault()
          commitRef.current()
          return
        }
        event.stopPropagation()
      }
      return React.createElement('textarea', {
        key: 'input',
        ref: inputRef,
        rows: 1,
        'aria-label': t('toolbarAnnotate'),
        placeholder: t('notePlaceholder'),
        value: scene.note || '',
        className: 'dsh-select-consent-note',
        onInput: onInput,
        onChange: onInput,
        onKeyDown: onKeyDown,
        'data-select-consent-note': 'true',
      })
    }

    /** The compact card for a passage that is already marked: only unmarking. */
    function cardChrome(scene, marked, t) {
      void scene
      if (!marked) return []
      return [
        React.createElement(
          'button',
          {
            key: 'unmark',
            type: 'button',
            title: t('unmarkTitle'),
            style: UNMARK_STYLE,
            onClick: function () {
              actRef.current('unmark')
            },
          },
          t('unmark')
        ),
      ]
    }

    /**
     * The compact card after 「取消标记」.
     *
     * It stands where the unmark button was, because that is where the reader is
     * looking, and it says what happened to the draft — including when nothing
     * could be done. 「撤销」 is only rendered when a block was actually removed
     * and the draft still holds exactly what the removal wrote.
     * @param {object} scene - the marked scene carrying the notice.
     * @param {function(string, object=): string} t - the translate function.
     * @returns {Array} the card's children.
     */
    function noticeCard(scene, t) {
      var notice = scene.notice
      var children = [
        React.createElement('span', { key: 'message', style: NOTICE_TEXT_STYLE }, notice.message),
      ]
      if (notice.undo !== null && notice.undo !== undefined) {
        children.push(
          React.createElement(
            'button',
            {
              key: 'undo',
              type: 'button',
              style: NOTICE_UNDO_STYLE,
              onClick: function () {
                undoRef.current()
              },
            },
            t('undo')
          )
        )
      }
      return children
    }

    /** The plugin's one stylesheet: the mark highlight and the count pulse. */
    function pulseStyleElement() {
      return React.createElement(
        'style',
        { key: 'pulse', 'data-select-consent-pulse-style': 'true' },
        PULSE_CSS
      )
    }

    function styleElement() {
      return React.createElement(
        'style',
        { key: 'style', 'data-select-consent-style': 'true' },
        MARK_CSS
      )
    }

    /**
     * The insert button, and the only thing this plugin draws in the composer.
     *
     * It appears when — and only when — the Session holds picks that asked to be
     * quoted and have not been written into the draft yet. Clicking it is the
     * whole exit: the picks are inserted as quote blocks, the button goes away
     * because there is nothing left pending, and no line of text is left behind
     * to say so.
     *
     * Nothing is rendered when there is nothing to insert. That is the point:
     * the composer belongs to the writer, and a plugin that keeps a permanent
     * row of counters under it is charging rent for a feature you are not using
     * this second.
     *
     * The seat is `conversation.input.left`, the composer's own tool row, which
     * is where `dsh-genui` puts its prompt toggle — so this button sits beside
     * that one instead of floating over the draft.
     * @param {object} props - the composer's props, plus `t` and the Session id.
     * @returns {object|null} the button, or null when nothing is pending.
     */
    function ConsentInsertButton(props) {
      var t = props.t
      var bumped = React.useState(0)
      var version = bumped[0]
      var setVersion = bumped[1]

      var buttonRef = React.useRef(null)
      var timer = React.useRef(null)
      // The count at the previous render, and whether the pulse is currently
      // showing. Both are refs: the pulse is a fire-and-forget side effect, and
      // putting it in state would re-render the toolbar on every pick.
      var lastCount = React.useRef(null)
      // State, not a ref: the attribute has to go away through React, or the next
      // render writes `data-pulse="true"` straight back and the second pick never
      // animates.
      var pulseState = React.useState(false)
      var pulsing = pulseState[0]
      var setPulsing = pulseState[1]
      var pointState = React.useState(null)
      var tooltipPoint = pointState[0]
      var setTooltipPoint = pointState[1]
      // The manual-mode notice: how many are waiting, shown once per batch.
      var hintState = React.useState(null)
      var hint = hintState[0]
      var setHint = hintState[1]
      var hintPointState = React.useState(null)
      var hintPoint = hintPointState[0]
      var setHintPoint = hintPointState[1]
      var hintTimer = React.useRef(null)
      // The pending automatic insert, one frame out. See `onFocusIn`.
      var autoTimer = React.useRef(null)
      // Re-armed by a new pick, disarmed by showing the notice. A batch of three
      // annotations is read out once, not on every trip through the composer.
      var armed = React.useRef(true)

      React.useEffect(
        function () {
          function onChange() {
            setVersion(function (n) {
              return n + 1
            })
          }
          watchers.push(onChange)
          return function () {
            var at = watchers.indexOf(onChange)
            if (at !== -1) watchers.splice(at, 1)
          }
        },
        []
      )

      // The seat knows its own Session, which beats inferring one from the DOM.
      var sessionId =
        typeof props.sessionId === 'string' && props.sessionId !== ''
          ? props.sessionId
          : currentSessionId()
      // Only picks made in the reply being answered are countable. A highlight
      // from an earlier turn is still a highlight, but it is not part of this
      // message and must not be offered as if it were.
      var scoped = scopedOf(marksOf(sessionId), sessionId)
      var pending = pendingOf(quotableOf(scoped))
      var ready = shared.actions !== null && typeof shared.actions.insertText === 'function'

      /**
       * The moment the reader arrives at the composer.
       *
       * This is the one event that means "I am about to answer". With auto on, it
       * is also the trigger: the set is inserted and the reader starts from a
       * draft that already says what they came to say. With auto off, it is when
       * the manual exit has to announce itself.
       *
       * Guarded against the plugin's own focus (cancelling the note box returns
       * the caret here) and against a composer that already holds text — a draft
       * the reader is writing is never touched.
       */
      React.useEffect(
        function () {
          function onFocusIn(event) {
            var editor = composerRoot()
            if (editor === null || !editor.contains(event.target)) return
            if (Date.now() < selfFocus.until) return

            var session = currentSessionId()
            if (session === null || session === '') return
            var waiting = pendingOf(quotableOf(scopedOf(marksOf(session), session)))
            if (waiting.length === 0) return

            if (autoEnabled()) {
              if (!(shared.actions !== null && typeof shared.actions.insertText === 'function')) {
                return
              }
              if (typeof shared.draft === 'string' && shared.draft !== '') return
              // One frame later. This runs inside `focusin`, and the pointer's
              // own caret placement lands *after* it: inserting here puts the
              // text in the right place and then the click moves the caret back
              // to where it was pressed — the start of the draft. Letting the
              // click finish first leaves the caret at the end of the inserted
              // block, which is where the sentence about the set belongs.
              if (autoTimer.current !== null) window.clearTimeout(autoTimer.current)
              autoTimer.current = window.setTimeout(function () {
                autoTimer.current = null
                if (typeof shared.draft === 'string' && shared.draft !== '') return
                if (!autoEnabled()) return
                aggregate(session)
              }, 0)
              return
            }

            if (!armed.current) return
            armed.current = false
            setHint({ n: waiting.length })
            setPulsing(true)
            if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
            hintTimer.current = window.setTimeout(function () {
              hintTimer.current = null
              setHint(null)
            }, 2400)
          }

          document.addEventListener('focusin', onFocusIn, true)
          return function () {
            document.removeEventListener('focusin', onFocusIn, true)
            if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
            if (autoTimer.current !== null) window.clearTimeout(autoTimer.current)
          }
        },
        []
      )

      /**
       * Park the bubble above the button, from the button's own box.
       *
       * Read on show and again on resize/scroll, because the composer sits at
       * the bottom of a scrolling column and the tool row moves under it.
       */
      function placeTooltip() {
        var node = buttonRef.current
        if (node === null) return
        var box = node.getBoundingClientRect()
        setTooltipPoint({ left: box.left + box.width / 2, top: box.top - 8 })
      }

      function showTooltip() {
        if (timer.current !== null) return
        timer.current = window.setTimeout(function () {
          timer.current = null
          placeTooltip()
        }, 120)
      }

      function hideTooltip() {
        if (timer.current !== null) {
          window.clearTimeout(timer.current)
          timer.current = null
        }
        setTooltipPoint(null)
      }

      var tooltipOpen = tooltipPoint !== null
      React.useLayoutEffect(
        function () {
          if (!tooltipOpen) return undefined
          function update() {
            placeTooltip()
          }
          update()
          window.addEventListener('resize', update)
          window.addEventListener('scroll', update, true)
          return function () {
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
          }
        },
        [tooltipOpen]
      )
      React.useEffect(function () {
        return hideTooltip
      }, [])

      // The button is resident: it is how a reader learns the feature exists, and
      // a control that appears and disappears is a control nobody finds. What
      // varies is its state, not its presence.
      //
      //   idle      nothing quoted yet. Dimmed and inert: it says "this is where
      //             quotes are inserted" without inviting a click that would do
      //             nothing.
      //   ready     `pending` quotes are waiting. Enabled, labelled with the
      //             count, and a click hands the whole set over.
      //   done      everything quoted has been handed over. Dimmed again, and
      //             still countable — the set is still on the page and still
      //             meaningful, it is just already in the draft.
      var total = quotableOf(scoped).length
      var hasPending = pending.length > 0
      var count = hasPending ? pending.length : total
      var label =
        count === 0
          ? t('insertPicksEmpty')
          : hasPending
            ? t('insertPicks', { n: count })
            : t('insertPicksDone', { n: count })
      var enabled = hasPending && ready

      // Pulse when the count grows, never on the first paint and never when it
      // falls (inserting the set is the reader's own click, and they watched it
      // happen). A ref, not state: this must not re-render the tool row.
      var grew = lastCount.current !== null && count > lastCount.current
      lastCount.current = count
      // A new pick arms the manual notice again: it is news since the last time
      // the reader was told.
      if (grew) armed.current = true

      var button = React.createElement(
        'button',
        {
          key: 'button',
          ref: buttonRef,
          type: 'button',
          style: Object.assign(
            {},
            INSERT_BUTTON_STYLE,
            !enabled ? INSERT_BUTTON_IDLE_STYLE : null
          ),
          'data-select-consent-insert': 'true',
          'data-count': String(count),
          'data-ready': enabled ? 'true' : 'false',
          'data-pulse': pulsing ? 'true' : undefined,
          'aria-label': label,
          'aria-disabled': enabled ? undefined : 'true',
          title: label,
          onMouseDown: function (event) {
            // Answering the composer toolbar must not move the caret out of the
            // draft: the reader may be mid-sentence.
            event.preventDefault()
          },
          onClick: function () {
            hideTooltip()
            if (enabled) aggregate(sessionId)
          },
          onMouseEnter: showTooltip,
          onMouseLeave: hideTooltip,
          onFocus: showTooltip,
          onBlur: hideTooltip,
        },
        // Words, not a glyph.
        //
        // An icon here has to carry two ideas at once — "these are quotations"
        // and "press to put them in the draft" — and at 14px a drawn quotation
        // mark reads as an arbitrary squiggle. A reader should not have to
        // decode a control to find out what it does, so the label says it: the
        // verb, then the count.
        React.createElement(
          'span',
          { key: 'verb', style: INSERT_VERB_STYLE },
          t('insertVerb')
        ),
        React.createElement(
          'span',
          { key: 'count', className: 'dsh-select-consent-count', style: INSERT_COUNT_STYLE },
          String(count)
        )
      )

      // Arm the pulse whenever the count grows.
      React.useEffect(
        function () {
          if (!grew) return undefined
          setPulsing(true)
          return undefined
        },
        [count]
      )

      // Disarm it when the animation finishes, so the next pick animates too.
      // `animationend` is the honest signal; the timeout is for a host that
      // never fires it (a headless check, or a tab that was throttled).
      React.useEffect(
        function () {
          if (!pulsing) return undefined
          var node = buttonRef.current
          if (node === null) return undefined
          var done = function () {
            setPulsing(false)
          }
          node.addEventListener('animationend', done)
          var fallback = window.setTimeout(done, 600)
          return function () {
            node.removeEventListener('animationend', done)
            window.clearTimeout(fallback)
          }
        },
        [pulsing]
      )

      var tooltip =
        tooltipPoint === null
          ? null
          : ReactDOM.createPortal(
              React.createElement(
                'span',
                {
                  key: 'tooltip',
                  role: 'tooltip',
                  style: Object.assign({}, INSERT_TOOLTIP_STYLE, {
                    left: tooltipPoint.left + 'px',
                    top: tooltipPoint.top + 'px',
                  }),
                },
                label
              ),
              document.body
            )

      // The notice is measured from the button every time it appears. The
      // composer sits at the bottom of a scrolling column, so a point captured
      // once would drift.
      React.useLayoutEffect(
        function () {
          if (hint === null) {
            setHintPoint(null)
            return undefined
          }
          var node = buttonRef.current
          if (node === null) return undefined
          var box = node.getBoundingClientRect()
          setHintPoint({ left: box.left + box.width / 2, top: box.top - 8 })
          return undefined
        },
        [hint]
      )

      var auto = autoEnabled()
      var autoSwitch = React.createElement(
        'button',
        {
          key: 'auto',
          type: 'button',
          style: AUTO_SWITCH_STYLE,
          'data-select-consent-auto': auto ? 'on' : 'off',
          'aria-pressed': auto ? 'true' : 'false',
          'aria-label': auto ? t('autoOn') : t('autoOff'),
          title: auto ? t('autoOn') : t('autoOff'),
          onMouseDown: function (event) {
            event.preventDefault()
          },
          onClick: function () {
            hideTooltip()
            setHint(null)
            setAutoEnabled(!autoEnabled())
          },
        },
        React.createElement('span', {
          key: 'dot',
          style: Object.assign({}, AUTO_DOT_STYLE, {
            border: auto
              ? '1px solid var(--dsw-alias-brand-primary, #4d6bfe)'
              : '1px solid var(--dsw-alias-label-tertiary, #999999)',
            background: auto ? 'var(--dsw-alias-brand-primary, #4d6bfe)' : 'transparent',
          }),
        }),
        React.createElement('span', { key: 'label' }, t('autoLabel'))
      )

      var hintBubble =
        hint === null || hintPoint === null
          ? null
          : ReactDOM.createPortal(
              React.createElement(
                'span',
                {
                  key: 'hint',
                  role: 'status',
                  'data-select-consent-hint': 'true',
                  style: Object.assign({}, INSERT_TOOLTIP_STYLE, {
                    left: hintPoint.left + 'px',
                    top: hintPoint.top + 'px',
                    // The brand edge is what makes the notice read as an action
                    // being asked for, not as a passive tooltip.
                    border: '1px solid var(--dsw-alias-brand-primary, #4d6bfe)',
                  }),
                },
                t('manualHint', { n: hint.n })
              ),
              document.body
            )

      return React.createElement(
        React.Fragment,
        null,
        pulseStyleElement(),
        button,
        autoSwitch,
        tooltip,
        hintBubble
      )
    }

    /**
     * Hand every not-yet-handed-over annotated pick to the composer, once.
     *
     * This is the only write the plugin makes to the composer, and it is the
     * moment the collected set becomes one message. The caret is left at the
     * end of what was inserted — `insertText` does that itself — so the sentence
     * that qualifies the whole set is the next thing typed.
     *
     * A pick with no note is not handed over: it says what was chosen, not what
     * is being said. Marks that are handed over stay marked, because the mark is
     * the durable thing and the draft is only one export of it.
     */
    function aggregate(explicitSessionId) {
      var sessionId =
        typeof explicitSessionId === 'string' && explicitSessionId !== ''
          ? explicitSessionId
          : currentSessionId()
      var marks = marksOf(sessionId)
      var pending = pendingOf(quotableOf(scopedOf(marks, sessionId)))
      if (pending.length === 0) return

      var draft = typeof shared.draft === 'string' ? shared.draft : ''
      var blocks = exportBlocks(pending)
      if (blocks.length === 0) return
      var lead = draft === '' || /\n$/.test(draft) ? '' : '\n'
      var body = []
      var records = []
      for (var i = 0; i < blocks.length; i++) {
        body.push(blocks[i].block)
        // The chunk is the unit a later 「取消标记」 searches for: the block plus
        // the blank line that follows it inside the inserted set. Recorded here
        // rather than re-derived later, because the draft is the editor's text
        // and this is exactly what was handed to it.
        records.push({ id: blocks[i].id, chunk: blocks[i].block + '\n\n' })
      }
      var text = lead + body.join('\n\n') + '\n\n'
      if (!appendToComposer(text)) return

      markExported(sessionId, records, lead)
      marksChanged()
    }

    // ---------------------------------------------------------------------
    // activation
    // ---------------------------------------------------------------------

    /**
     * Read the active locale, with the Chinese dictionary as the floor so a
     * host that binds nothing still shows words instead of keys.
     * @param {object|null} locale - the Client locale service, when present.
     * @returns {function(string): string} the translate function.
     */
    function makeTranslator(locale) {
      var translate = null
      if (locale !== null && typeof locale.bind === 'function') {
        try {
          translate = locale.bind(NS)
        } catch (error) {
          translate = null
        }
      }
      return function (key, params) {
        var raw = null
        if (translate !== null) {
          try {
            var value = translate(key, params)
            if (typeof value === 'string' && value !== '' && value !== key) raw = value
          } catch (error) {
            /* A broken dictionary must not break the popup. */
          }
        }
        if (raw === null) raw = ZH[key] || key
        return params === undefined ? raw : fill(raw, params)
      }
    }

    /** Substitute `{name}` placeholders in a dictionary string. */
    function fill(template, params) {
      return template.replace(/\{(\w+)\}/g, function (whole, name) {
        return params[name] === undefined ? whole : String(params[name])
      })
    }

    /**
     * Client activation.
     * @param {object} ctx - client root context.
     */
    function apply(ctx) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return

      var slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : null)
      var locale = ctx.locale || (typeof ctx.get === 'function' ? ctx.get('locale') : null)
      var t = makeTranslator(locale)

      if (locale !== null && typeof locale.register === 'function') {
        try {
          ctx.effect(function () {
            return locale.register(NS, { zh: ZH, en: EN })
          }, 'dsh-select-consent: dictionaries')
        } catch (error) {
          console.warn('[dsh-select-consent] locale registration failed', error)
        }
      }

      if (
        slots === null ||
        typeof slots.inject !== 'function' ||
        typeof slots.register !== 'function'
      ) {
        console.warn('[dsh-select-consent] slot service unavailable')
        return
      }

      if (highlightRegistry() === null) {
        console.warn(
          '[dsh-select-consent] CSS Custom Highlight API unavailable; marks will not be painted'
        )
      }

      // The popup floats above every column, outside every scroll container.
      try {
        ctx.effect(function () {
          return slots.inject('shell.overlay', function () {
            return slots.register(
              {
                name: 'shell.overlay',
                id: 'select-consent',
                order: 40,
                locale: NS,
                inject: function () {
                  return { t: t }
                },
              },
              ConsentPopup
            )
          })
        }, 'dsh-select-consent: popup seat')
      } catch (error) {
        console.warn('[dsh-select-consent] popup registration failed', error)
      }

      // The invisible seat that borrows the Session's input face.
      try {
        ctx.effect(function () {
          return slots.inject('conversation.input.dock', function () {
            return slots.register(
              {
                name: 'conversation.input.dock',
                id: 'select-consent-bridge',
                order: 0,
                locale: NS,
                inject: function () {
                  return {}
                },
              },
              ConsentBridge
            )
          })
        }, 'dsh-select-consent: composer bridge')
      } catch (error) {
        // Without the bridge the popup still answers, through the DOM route.
        console.warn('[dsh-select-consent] composer bridge registration failed', error)
      }

      // The exit, as one icon button in the composer's own tool row. It borrows
      // the seat `dsh-genui` uses for its prompt toggle so the two sit in one
      // row; `order` keeps this one to its right.
      try {
        ctx.effect(function () {
          return slots.inject('conversation.input.left', function () {
            return slots.register(
              {
                name: 'conversation.input.left',
                id: 'select-consent-insert',
                order: 10,
                locale: NS,
                inject: function () {
                  return { t: t }
                },
              },
              ConsentInsertButton
            )
          })
        }, 'dsh-select-consent: insert button')
      } catch (error) {
        console.warn('[dsh-select-consent] insert button registration failed', error)
      }

      // A small surface for debugging and for a check that cannot click.
      window.__dshSelectConsent = {
        bridge: shared,
        append: appendToComposer,
        read: readSelection,
        marks: marksOf,
        addMark: addMark,
        removeMark: removeMark,
        restoreMark: restoreMark,
        markExported: markExported,
        withdraw: withdrawComposerBlock,
        chunkOf: chunkOf,
        pending: pendingOf,
        aggregate: aggregate,
        derive: deriveMarks,
        // The anchoring projection and the composer formats, exposed so a check
        // can round-trip them without a browser.
        pack: pack,
        packedMapOf: packedMapOf,
        locate: locate,
        quoteBlock: quoteBlock,
        composeAggregate: composeAggregate,
        noteOf: noteOf,
        setMarkNote: setMarkNote,
        quotableOf: quotableOf,
        quotedOf: quotedOf,
        scopedOf: scopedOf,
        currentReplyKey: currentReplyKey,
        buildAggregate: buildAggregate,
        fill: fill,
        popup: function () {
          return document.querySelector('[' + POPUP_MARKER + ']')
        },
        insertButton: function () {
          return document.querySelector('[data-select-consent-insert]')
        },
      }
      ctx.effect(function () {
        return function () {
          if (window.__dshSelectConsent !== undefined) delete window.__dshSelectConsent
        }
      }, 'dsh-select-consent: debug surface')
    }

    // The factory IS the module: the loader takes this return value as the
    // package's Client exports. (`module.exports` here would be a
    // ReferenceError — this file is not wrapped in a CommonJS module.)
    return { name: 'dsh-popup', inject: ['slots', 'locale'], apply: apply }
  },
})
