# Verification record

Date: 2026-11-04. Verification includes source review, TypeScript, isolated unit tests, the explicitly authorized Chrome extension build, and a later user-authorized browser check on two supplied posts. That check used the user's already-running app in Dia. The agent did not start a server or run a Next.js build.

## Automated checks

- PASS: `npm run typecheck` completed with no TypeScript diagnostics.
- PASS: `npm test` completed with 142 tests across 10 files, including DOM, snapshot, payload, handoff, and Next Babel transform regression tests.
- PASS: `npm run extension:build` produced local popup, capture, and service-worker bundles plus the manifest/HTML/CSS in `extension/dist`.
- PASS: Test setup blocks live fetch; provider responses are injected fixtures.
- PASS: Installed Astryx CLI docs confirmed Theme, Button, TextInput, Card, Badge, Banner, TabList, and Tab imports/props. CSS package exports resolve locally.

## Antislop delivery review

### Hard Gate

- PASS (source): No fabricated posts, media, statistics, testimonials, security claims, or navigation destinations. Fixtures exist only under tests.
- PASS (source): Inspect submits a real route request, tabs switch report panels, Copy JSON uses the clipboard with failure feedback, and original-post links use the normalized provider URL.
- PASS (source): Empty, bounded loading, validation error, provider failure, unavailable preview, and partial results have visible explanations.
- PASS (source): Labels, alert/status regions, tab/panel associations, and theme-based focus outlines are present. Keyboard behavior in the browser is pending manual review.
- PENDING MANUAL: Mobile overflow, rendered contrast, all controls, clipboard, actual provider previews, and SDK failures. No browser-level PASS is claimed.
- USER LIMIT (R-35): Runtime/build/click-through verification is deferred to the user. This takes precedence over the skill's usual runtime gate.

### Purpose Gate

- PASS (source): Cards separate preview, field report, and readiness. Status badges indicate observed outcomes; common unavailable fields use plain text. There are no decorative gradients, glows, illustrations, or animation loops.
- PASS (source): Typography and colors come from Astryx neutral. Charcoal page and lighter surface tokens implement the approved dark direction.

### Liveliness and direction

- PASS (source): ENERGY 1 / RHYTHM 1 / MOTION 1 follows the restrained data-inspection brief. The input is the first focal point; field provenance and explicit blockers are the recurring report structure.
- PENDING MANUAL: Assess the actual composition, spacing, initial dark paint, and responsive result panels.

### Craftsmanship and quality

- PASS: Tests cover provider-aware parsing, normalization, URL rejection, all active adapter endpoints, HTTP failures, timeout, streamed size limits, sanitization, partial results, provenance, normalized JSON separation, permission/format uncertainty, and route validation.
- PASS (source): Theme is fixed to dark in initial HTML and the Theme provider. No theme switch or unused application features are included.
- PENDING MANUAL: Build compatibility, StyleX output, rendering, external font loading, endpoint access, SDK globals, and live acceptance scenarios in README.

This is a source implementation handoff, not a claim that live prototype acceptance has passed. Record actual post findings in README after manual checks.

## Babel loader correction

The user's first manual dev run reported that Next.js rejects `babel.config.cjs`. The installed loader source confirms it accepts JSON or `.js` configs. Configuration now uses `babel.config.json`, shared with PostCSS, with complete StyleX options in both development and production. The new regression tests use Next's own config discovery and bundled Babel option loader, without starting the app or building it. An explicit `outputFileTracingRoot` keeps the project root separate from the home-directory lockfile. Runtime startup still awaits the user's rerun.

## Chrome capture update

The user's manual run exposed a failure in Next's bundled Unicode regexp transform (`e.charCodeAt is not a function`) for the hashtag character class. An isolated test reproduced it using the installed Next Babel preset. The pattern now uses a runtime RegExp constructor with identical Unicode matching. Development/production Babel transforms and multilingual hashtag cases pass. This verification does not start or build the Next.js app.

- PASS (source): Capture requires an explicit popup button click; popup initialization reads only the tab URL and an existing temporary capture. No persistent content script or host permissions are declared.
- PASS: DOM fixture tests distinguish post text from comments, recommendations, nested posts, hidden/clipped text, carousel lists, and page navigation. Fixtures are synthetic and never loaded as application results.
- PASS: Normalization tests enforce identity/size/source constraints, preserve media as references, discard injected HTML/secret extra properties and readiness claims, and derive hashtags only from captured text.
- PASS: Session/bridge tests cover exact origin/top-frame checks, malformed messages, replacement, expiry, concurrent one-time consumption, request deduplication, bridge timeout, and missing/forged results.
- PASS (source): Captured text remains technically accessible with permission unverified; no model or media download is called. The inspector requests preview with URL only and retains DOM values independently of that request.
- PASS (source): Popup uses local dark CSS and accessible labelled buttons/status. The existing inspector uses Astryx; the new JSON fallback uses TextArea after checking its CLI documentation.
- PASS (live, narrow scope): The existing extension captured the supplied Instagram photo and Threads video post and imported each through the actual external-message bridge into the running app in Dia. Author/text matched the primary posts; inspected results excluded replies/comments. Instagram returned the correct post image reference after excluding the empty-alt comment-composer avatar. Threads returned a page-scoped blob video reference. Permission stayed unverified and media stayed reference-only.
- PENDING MANUAL: Other posts/layouts, Chrome-specific installation, playback, visual/keyboard/mobile checks, and end-to-end comparison/JSON fallback flows. Complete live acceptance is not claimed.

## Post-context correction

The tested Instagram page had no article or h1 and used a username-prefixed timestamp permalink. The Threads page used div-based pressable cards without articles. Adapters now match those observed structures, isolate author-associated text, and exclude comment/composer media. Five new synthetic-layout regression tests cover these structures, ambiguity, prefixed URL matching, and comments/recommendations. README records the two live findings without retaining caption/media payloads.

## Collaboration and modal follow-up

- PASS: Linked Instagram captions preserve mentions/hashtags. Collaboration header accounts have a separate field; order does not establish sole ownership. Older envelopes remain importable.
- PASS: Synthetic regressions cover active-dialog isolation, background refusal, rendered offscreen context links, compact collaboration labels, interactive h1 captions, shared post/comment wrappers, scoped location/audio metadata, and reference-only media. Context matching may use a rendered offscreen permalink; captured field values still require viewport visibility.
- PASS (live, narrow scope): The newly supplied collab permalink was tested in Dia as a full page and through its profile modal. The final modal capture imported 9 content fields, including linked caption, both collaboration accounts, visible location label, timestamp, and video reference. Comments were excluded from the inspected caption. No caption or media payload is retained in this record.
- LIMITATION (live): The official preview endpoint returned HTTP 400 for that URL. The exact provider rejection cause and privacy/deletion status remain unknown. A successful DOM capture does not establish embed availability.
- PENDING: Original-audio label support passed fixtures, but the final live capture left audioLabel unavailable. Rotating/clipped labels are not exposed by clicking or scrolling. Other collaboration layouts and audio labels remain unverified. No audio file was fetched.

## Username-prefixed Reel and poster correction

The popup's URL validation previously rejected /username/reel/ID, leaving Capture disabled. Shared parsing now accepts username-prefixed Instagram post/Reel permalinks, normalizes them without changing the identifier, and does not infer author identity. Visible video posters can populate thumbnailUrl as reference-only metadata; absent/unsafe posters remain unavailable with a reason. Typecheck, 130 unit tests, and the extension build passed. No computer use, live request, app server, or Next.js build was used for this correction. The supplied Reel URL and its actual poster availability still require a manual check after extension reload. Changing URL normalization is not evidence that the earlier provider HTTP 400 has been resolved.

## Snapshot fallback and plural Reels update

- PASS: Typecheck and 142 isolated tests across 10 files. Tests cover plural/username-prefixed URL normalization, feed/audio rejection, creator-vs-mention selection, hidden recommendations and ambiguous visible players, cropped bounds/overlay rejection, screenshot pixel scaling, source-tab and media guards, unavailable capture paths, JPEG size/dimension/format checks, one-time snapshot consumption, and separation from inspection JSON/readiness.
- PASS: Extension build produced popup/background/capture artifacts with the existing activeTab, scripting, and storage permissions. No app build or server was started.
- PASS (live, narrow): The user-supplied plural Reels permalink captured successfully in Dia. The popup confirmed a snapshot, the real bridge imported it, and Memoar rendered the cropped source media as Captured snapshot alongside the unchanged official HTTP 400 outcome. Visual inspection confirmed the crop contained post media rather than navigation/comments. Four DOM/media fields were available; caption/audioLabel remained explicit missing values.
- OBSERVED: The source page's audio attribution read Justin Bieber · I DO, linking to /reels/audio/1096536585924625/. It was reported separately, not promoted into a missing capture field. Other audio layouts remain unverified.
- PASS (Antislop hard gate, scoped): Actual captured media is labelled static and unverified; no fabricated previews, new assets, or readiness claims. The added toggle has real handlers, and failed snapshot decode has a visible fallback. Live snapshot rendering was checked; unrelated controls and responsive/keyboard review remain manual.
- PASS (Antislop purpose gate): Snapshot imagery serves the approved fallback when provider display fails. Existing Astryx neutral dark panels, tokens, and controls are retained, with only scoped image sizing CSS.
- PASS (Antislop direction): Existing ENERGY 1 / RHYTHM 1 / MOTION 1, report hierarchy, and provenance labels are preserved.
- PASS (Antislop craftsmanship, scoped): Existing URL-only/oEmbed tests remain passing; snapshot pixels stay outside exported inspection JSON and AI inputs. Remaining manual scenarios are listed in README; broad acceptance is not claimed.
