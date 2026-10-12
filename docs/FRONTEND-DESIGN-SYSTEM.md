# Builder workspace UI

The local GUI, Electron window, and hosted builder share `apps/gui/public/`. The hosted client adds account and ownership controls through its existing request-time overlay. Login, registration, and administration load the same UI utilities and design tokens. This is the application design system; Elementor resources and their schemas remain documented separately in `VNEXT-DESIGN-SYSTEM.md`.

## Foundations

`design.css` defines semantic colors for surfaces, text, borders, primary actions, success, warning, danger, and focus. Light and dark modes use the same component selectors. Typography uses system fonts, with no remote font requests. Panels use a 16px radius and layouts follow an 8px spacing rhythm. Icons are inline, decorative SVGs paired with visible navigation labels.

`ui.js` runs in the document head to resolve Light/Dark/System before paint. The preference is stored in `wpstarter.theme`, defaults to the system, responds to system changes, and remains usable when browser storage is unavailable. It also provides queued native dialogs, persistent error notifications, linked field validation, and interruptible entrance motion.

Motion timings are 120ms for feedback, 180ms for sections/progress, 220ms for entrances, and 150ms for exits. Required UI state is applied directly, independently of animation callbacks. Reduced motion removes movement and transitions.

## Workspace behavior

Navigation groups existing views into Workspace, Library, and Design. Below 1024px the sidebar collapses; below 768px it becomes a keyboard-accessible drawer with focus containment. Long tables scroll within panels rather than expanding the page. The Electron minimum window size remains unchanged.

Profiles owns the existing profile fields in five labelled steps: Basics, Packages, Design & fonts, Templates & content, and Review. Fields retain their IDs and payload formats. Step switches preserve selections; library refreshes preserve the active editor's values. Save validation links to the step containing each problem. Build selects a saved profile, summarizes it, and invokes the existing asynchronous build endpoint. Actual job progress remains visible across views.

Resource libraries have local search, plus type filters for packages and templates. Typography, color, and design-system editors open explicitly. Typography has independent Theme Style and Global Fonts tabs; less common row properties live in More settings. Sample authoring retains all supported post/product settings and uses an offline asset chooser.

Dirty editors offer Keep editing or Discard when leaving or replacing the draft. Closing a dirty page invokes the browser's unload warning. Successful writes clear dirty state; failures retain values. No drafts are automatically written to the shared library. Concurrent identical mutations are coalesced; uploads are serialized. Errors stay visible until dismissed, and field errors remain until the next validation attempt.

Hosted markup retains the overlay's item IDs, action classes, and ownership metadata. Another account's resources remain visible and read-only, with duplication/build actions retained where allowed. Permissions and CSRF are enforced by the existing server APIs.

## Verification

Run `npm run check` and `npm run verify:artifacts`. The latter checks that the new UI assets ship in the builder ZIP.

For real browser interaction and screenshot verification, run `node scripts/verify-ui.mjs` with Playwright available as a development tool. A bundled or external installation can be selected with `WP_UI_PLAYWRIGHT` pointing to its package directory. `WP_UI_BROWSER` selects the installed browser channel (default: Chrome). No production dependency is added.

The browser script uses temporary synthetic libraries and an isolated in-memory hosted server. It checks wizard selections, draft guards, search, typography device/tab retention, build progress across views, theme contrast, reduced motion, hosted ownership and CSRF, account screens, and page overflow. Screenshots for both themes at 375, 768, 1024, and 1440px are written to ignored `artifacts/ui-review/`. Actual build generation remains covered by existing GUI/server tests; the browser progress sequence is synthetic to make navigation checks deterministic.
