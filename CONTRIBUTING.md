# Contributing

Thanks for taking the time to look at this. It is one plugin and two checks, so
the loop is short.

## Before you open a PR

```sh
npm install                       # Playwright is the only dev dependency
npx playwright install chromium   # skip if you already have it
npm run check                     # both checks
```

Both checks must pass. `check:flow` prints `SKIP` when no browser is available —
that is not a pass, and a PR that changes the popup should say whether the
browser check actually ran on your machine.

## What lives where

| Path | What it is |
| --- | --- |
| `lib/index.js` | The Host face. Intentionally empty; it gives the Loader a row to mount. |
| `lib/client.js` | The whole feature, as one `window.__ModuleLoader__` factory. |
| `tools/check-client-bundle.mjs` | Boot contract and anchor round-tripping, no browser. |
| `tools/check-note-flow.mjs` | The feature, in a real browser with real React. |
| `cordis.patch.yml` | The bundle patch that inserts the plugin row. |
| `docs/media/` | Local scratch for demo media. Git-ignored on purpose: README points at a GitHub attachment URL instead, so the repo never carries the binary. See `docs/demo-storyboard.md`. |

There is no build step. `lib/client.js` is loaded exactly as it is written, and
a factory-body `ReferenceError` blocks the whole web boot rather than just this
plugin — which is why `check:bundle` runs the factory the way the loader does.

## Style

- The code is plain ESM and browser JavaScript: no JSX, no TypeScript, no
  bundler. `React.createElement` and `h()` helpers are used directly.
- Comments explain *why* a thing is the way it is, especially where an earlier
  version got it wrong. Keep that habit: the reasoning is the expensive part.
- The popup's UI strings and the README are Chinese, matching the product. Code and
  comments are English.
- Only `--dsw-alias-*` theme tokens for chrome. The `::highlight()` rule is the
  one deliberate exception (it needs literal colours); see docs/design.md for why.

## Reporting a bug

Include the DSH version, the browser console error if there is one, and whether
the passage you selected came from a Conversation flow item or from somewhere
else (the sidebar, a document preview). A selection outside the transcript is
handled differently on purpose.
