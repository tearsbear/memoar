# Memoar / Post Inspector

A feasibility prototype for Instagram, Threads, and Facebook, with URL-only inspection and optional user-triggered Chrome DOM capture. The existing Next.js page reports identity, display availability, field provenance, and AI payload blockers. No sample results are loaded into the page.

## Local setup

Node.js 22+ and npm are required.

```sh
npm ci
npm run dev
```

Open `http://localhost:3000` yourself. The dev script uses Webpack for the Astryx Next.js + StyleX Babel/PostCSS integration. The agent has not started a server or run a Next.js build. A later user-authorized browser check used the already-running app and the two supplied posts; see the findings below.

The Babel config is `babel.config.json`: Next's loader does not support a `.cjs` Babel config. PostCSS reads the same JSON, including the production options. An explicit tracing root keeps Next scoped to this project. Stop an existing dev process before restarting after configuration changes.

No credentials are required. The optional server-only `MEMOAR_EMBEDS_ENABLED=false` switch disables remote embed attempts. Copy `.env.example` to `.env.local` only if you want to configure it. No Meta/AI token or client secret is used.

```sh
npm run typecheck
npm test
```

Unit tests inject provider responses and call the route directly without an application server. Test setup rejects live `fetch` calls. Fixtures verify logic only and are never used as app results.

## Interface and design

- Astryx neutral, fixed dark mode, including initial HTML and native controls.
- Charcoal surfaces, soft text, restrained borders, and functional status labels follow the requested ChatGPT-like dark direction.
- Astryx supplies inputs, buttons, cards, badges, tabs, and error banners. Layout CSS uses theme colors; small component adjustments use StyleX `xstyle`.
- ENERGY 1 / RHYTHM 1 / MOTION 1. The URL input is the starting focal point, results follow it, and spacing separates observations from interpretation.
- Figtree comes from the selected theme for consistent component typography. Its generated font stylesheet requests Google Fonts; system fonts remain available if blocked.
- Provider embeds retain their own appearance. Their iframe contents are not recolored.

## Supported URLs

Only HTTPS is accepted, without embedded credentials or nonstandard ports. Hosts match exactly, not by suffix. Invalid input never triggers provider retrieval.

| Platform | Paths | Official preview attempt |
| --- | --- | --- |
| Instagram | `/p/{shortcode}`, `/reel/{shortcode}`, `/reels/{shortcode}`, plus username-prefixed equivalents | Yes |
| Threads | `/@{handle}/post/{shortcode}`, `/t/{shortcode}` | Yes |
| Facebook | `/{account}/posts/{id}`, `/reel/{numericId}` | Yes |
| Facebook | `/{account}/videos/{numericId}`, `/watch/?v={numericId}` | URL parsing and source-link fallback only |

Instagram and Threads accept bare and `www` hosts. Threads also accepts legacy `threads.net`, normalized to `www.threads.com`. Facebook accepts bare, `www`, and `m` hosts, normalized to `www.facebook.com`. Known tracking and fragments are removed; identifiers and other query parameters are preserved. Credential-like query keys are rejected rather than echoed in JSON.

Username-prefixed Instagram links normalize to `/p/{shortcode}/` or `/reel/{shortcode}/`; plural `/reels/{shortcode}/` normalizes to singular `/reel/`. The username is not treated as verified authorship, and the identifier is preserved in full. `/reels/` and `/reels/audio/{id}/` are not supported post inputs. Video capture can supply `thumbnailUrl` from a visible player's allowlisted `poster` attribute when no post image was captured. Missing/ambiguous posters remain explicit. The separately authorized snapshot feature captures viewport pixels locally; it does not download media or extract a file from the video player. A poster remains reference-only.

Profiles, Stories, share/short links, `permalink.php`, `story.php`, and other patterns are unsupported. No redirect expansion is performed. Facebook video/watch parsing is included, but its display pattern is skipped because the consulted official integration explicitly demonstrates post and Reel patterns. The result reports `not_configured` with a reason.

## Retrieval and usage limits

The [official Meta Embeds integration](https://github.com/meta/meta-embeds-for-wordpress) documents tokenless display requests. This app independently implements display-only requests to its referenced endpoints:

| Adapter | Fixed endpoint |
| --- | --- |
| Instagram | `https://graph.facebook.com/v25.0/instagram_oembed` |
| Threads | `https://graph.threads.com/oembed` |
| Facebook post | `https://graph.facebook.com/v25.0/oembed_post` |
| Facebook Reel | `https://graph.facebook.com/v25.0/oembed_video` |

Endpoint access rules may change. Official developer pages were not consistently accessible during implementation; the official integration source was readable. No successful endpoint request, app permission, or broad right to process creator content is claimed. Review [Meta Platform Terms](https://developers.facebook.com/terms/), [Instagram oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed/), and [Facebook oEmbed](https://developers.facebook.com/docs/plugins/oembed/) before extending usage. Third-party articles are not treated as permission.

- Server fetch goes only to fixed Graph API hosts and paths. Input URLs are never fetched directly. Redirects are rejected; localhost/private-IP inputs fail the provider allowlist.
- Each attempt has an 8-second timeout, a streamed 1 MiB limit, and no automatic retry. The client has a separate 15-second timeout.
- Display HTML is sanitized. Scripts, handlers, styles, images, and non-allowlisted URLs are removed. Only fixed official SDK URLs are loaded on the client.
- Embed HTML is transient. Provider fetch and route responses use `no-store`. There is no database, localStorage, media download, response-body logging, or persistent dataset.
- External SDKs make provider-controlled browser requests under Meta's terms and privacy policy; these are separate from the app's bounded server fetch.
- Failures do not imply privacy or deletion. Rate limits, permission errors, service errors, malformed responses, and timeouts retain their reasons.
- Set `MEMOAR_EMBEDS_ENABLED=false` if the installation cannot use official display requests.

## Observation contract

`POST /api/inspect` accepts `{ "url": "https://..." }` and returns `{ inspection, display }`. `display` contains sanitized display-only markup, or `null`. Raw JSON and Copy JSON serialize **only `inspection`**, not the raw Meta response.

Every field has value, status, source, reason, and processing eligibility. Unknown values are `null`; `[]` requires a confirmed empty collection. URL-derived IDs do not prove existence. Author ownership is not inferred from a username in a URL. Paths do not prove actual media type.

No permitted content API is configured in the URL-only baseline. Its caption, text, author, hashtags, media, publication time, and location remain unavailable with reasons. Extension capture can separately add observed DOM fields, with browser provenance and unverified processing eligibility. Neither path uses oEmbed metadata to populate content. `preview.status=available` means safe display markup was received; `renderStatus=unverified` stays explicit. SDK initialization, iframe load, and visible preview do not prove accessible media bytes.

Readiness follows the [Meta model catalog](https://dev.meta.ai/docs/models): Muse Spark 1.3 takes text/image/video/audio; SAM 3.1 needs image/video plus a target or prompt; Muse Voice Transcribe needs audio. No AI SDK, key, or request is included. Ready requires accessible content, supported format, and processing permission. Unknown permission is never ready. A media URL alone does not verify bytes or format; an identifier alone does not satisfy an AI modality.

## Manual acceptance and findings

The general acceptance checklist remains pending except for the two specific extension captures recorded below. Use public posts you own or have permission to use. Do not substitute fabricated content when retrieval fails.

| Case | What to verify | Status |
| --- | --- | --- |
| Instagram image | Parsed ID, preview/fallback, provenance | Not tested |
| Instagram Reel | Playback differs from direct `videoUrl` and AI readiness | Not tested |
| Instagram carousel | Type/count stay unknown unless actually retrieved | Not tested |
| Threads text | Text available only through a permitted retrieval path | Not tested |
| Facebook post/Reel | Partial observations survive display failure | Not tested |
| Private/restricted/deleted | No fabricated fields or unverified failure causes | Not tested |
| Invalid URL / fake hostname | Inline rejection; no provider request | Unit tested; browser not tested |
| Disabled display / permission error | Clear status, reason, original-post fallback | Unit tested; live not tested |
| JSON / clipboard | Valid nonsecret observations; copy success/failure | JSON unit tested; clipboard not tested |
| Dark UI / keyboard | Initial dark paint, focus, Enter, tabs | Not tested |
| Mobile / long values | 320px, 390px, 768px, desktop; no page overflow | Not tested |
| Provider / SDK failure | Loading ends; fallback; render stays unverified | Server paths unit tested; live not tested |

Record real findings with URL, UTC test time, platform, attempted methods, available fields, preview result, readiness per model, failure reason, and needed configuration/permission. Specific extension findings are recorded below without caption or media payloads.

Typecheck and unit tests do not establish a running prototype or live acceptance. Build compatibility, SDK rendering, browser behavior, contrast, mobile layout, and endpoint access await your manual check.

## Sources

See the Chrome extension setup and manual acceptance guide below for the added capture path.

- [Astryx Getting Started](https://astryx.atmeta.com/docs/getting-started) and installed CLI component docs.
- [Astryx Next.js + StyleX example](https://github.com/meta/astryx/tree/main/apps/example-nextjs-stylex).
- [Official Meta provider definitions](https://github.com/meta/meta-embeds-for-wordpress/blob/main/includes/class-meta-embeds.php).
- [Meta model catalog](https://dev.meta.ai/docs/models).

Research date: 2026-11-04. References do not imply live verification.

## Chrome extension: setup and first capture

Use Chrome 112+ in the same browser profile for the source post and Memoar. No Meta app, OAuth, API token, or Chrome Web Store registration is needed for this local experiment. Browser access is not itself Meta authorization for data collection or AI processing; use your own or appropriately authorized content.

1. From this repository, run `npm install` if dependencies changed, then `npm run extension:build`.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `/Users/jiaan/Downloads/meta/extension/dist`.
3. Pin **Memoar Post Capture** through Chrome's extensions menu. An icon asset is not required; Chrome supplies its default extension icon.
4. Start the existing app yourself with `npm run dev` (without `sudo`). Use **http://localhost:3000**. A different port, `127.0.0.1`, or the LAN address is not approved for automatic handoff.
5. Open a direct Instagram post or Reel permalink you are authorized to test. Let the desired text and media render visibly. Expand the caption yourself first if you want to capture more visible text; Memoar will not click or scroll for you.
6. Click the extension icon, verify its page/platform, and press **Capture current post**. Capture is performed only after that button click. Closing the popup does not start another capture.
7. Review the partial status and available-field count, then click **Open in Memoar**. The destination URL contains only a random capture ID and extension ID; neither needs manual environment configuration.
8. The existing inspector imports the capture into browser memory. Review **Source: browser_extension**, values, reasons, and media **reference only** labels. Real text may be technically captured while permission stays unverified; it is not Ready for AI.
9. Click **Compare with URL-only** to inspect the same URL without DOM data; switch back with **Captured via Extension**. Only the post URL is sent to the existing preview endpoint. The returned URL-only fields never replace captured values.

The extension build has been produced locally. Two supplied posts were captured successfully in the user's existing Dia Chromium profile, including automatic handoff to the running Memoar app. Other browser/platform combinations remain untested.

### Manual JSON fallback

If the bridge is unavailable, remain within the five-minute capture window:

1. Open the extension popup and choose **Copy captured JSON**. If clipboard writing is blocked, a selected read-only JSON box appears for manual copy.
2. In Memoar, choose **Paste captured JSON**, paste the extension's version 1 envelope, and press **Import capture**. This is not a manual caption-entry form. The inspector's ordinary Raw JSON export is a report, not this transport envelope.
3. The same validation is applied to manual and automatic imports. Forged permission/readiness claims are ignored; DOM provenance is an unverified observation, not an API attestation.

A successful automatic handoff consumes the session capture. If you already imported it or let it expire, capture the post again. Missing/expired captures and wrong extension IDs produce explicit errors rather than an empty success result.

### Permissions, retention, and extraction limits

- Permissions are only `activeTab`, `scripting`, and `storage`. No persistent content script, site-wide host permissions, cookies, history, clipboard-read, or network interception is used.
- A packaged script runs after an explicit capture click in the active tab's main frame in the isolated world. It reads visible post nodes, not script tags, React state, page HTML dumps, or private API responses. Image candidates may be checked through anonymous CORS GET requests to their observed allowlisted CDN URLs; credentials, redirects, opaque responses, and private APIs are not used.
- The temporary isolated-world request marker contains only a per-click nonce and URL; it is owned by the extension and deleted when the capture script starts. It is not source-site hidden state.
- The service worker accepts capture results only from its explicitly requested tab, URL, main frame, and request nonce. External retrieval accepts only a specific random capture ID from the top-level `http://localhost:3000` origin; other web origins/ports and other extensions are rejected.
- A single pending capture is stored in `chrome.storage.session`, inaccessible to content scripts. New success replaces the previous capture; an import removes it once. Five-minute TTL is enforced on every storage access, with lazy removal at the next access/worker startup; Chrome clears session storage on browser restart or extension reload. There is no database, localStorage, analytics, or captured-content logging.
- Initial DOM reading has at most three attempts over a three-second window. Optional carousel navigation is bounded to 20 slides and 30 seconds; image verification has a 15-second budget, 2.5 seconds per resource, and a 10 MiB image limit. A 55-second worker timeout bounds the response; optional snapshot cropping happens afterward. Navigation to another post discards the result. Carousel index query changes are allowed for the same validated post. The web bridge times out after five seconds.
- Caption/text selection is intentionally conservative: Instagram supports caption headings and author-associated visible text blocks; Threads supports scoped text within matching semantic/pressable cards and permalink-associated div containers; Facebook uses a scoped message block. Instagram's username-prefixed DOM permalinks are recognized when matching the active post. A unique post container must be isolated; markup changes may leave values null or stop capture.
- Header avatars, profile-linked images, small UI images, comments, recommendations, nested posts, hidden nodes, and clipped neighboring slides are excluded. Tag links inside a media slide do not make that slide a comment. Post images use the highest explicit supported srcset resolution when available; URLs are not rewritten to guess originals. Clipped caption text is not expanded or reconstructed. Instagram location labels require an identifiable location link in the author header. No coordinates are inferred.
- Instagram collaboration headers populate `collaboratorHandles` with the explicitly listed accounts. `authorHandle` is the first observed account, with an ordering limitation rather than a sole-ownership claim. Caption mentions are preserved as text and are not collaborators.
- `audioLabel` records a scoped audio-attribution link or a visible Original audio / Audio asli header label. It is metadata, not an audio file or AI audio input. Rotating/hidden labels may remain null; the extension does not click to expose them. Older envelopes without these two new fields remain importable.
- Media URLs are references from observed elements, restricted to Meta CDN HTTPS hosts or source-platform `blob:` references. Unsupported or credential-like references are omitted with a warning. There are no downloads, file accessibility checks, or image previews built from capture URLs.
- Capture envelopes are limited to 256 KiB, field text to 32,000 characters, image references to 20, media/profile URLs to 4,096 characters, and warning/reason text to 1,000 characters. The existing post parser retains its 2,048-character input limit. Invalid over-limit payloads are rejected without silently truncating their values.
- The extension popup uses local dark CSS without loading Astryx, remote scripts, or fonts. The main web inspector keeps Astryx dark. The only extension output artifacts are local packaged files.

### Updating and troubleshooting

After source changes, run `npm run extension:build`, then click **Reload** for Memoar at `chrome://extensions`. Reload clears any pending session capture; capture again. Run `npm run typecheck` and `npm test` to check code without starting the application.

| Symptom | What to do |
| --- | --- |
| No supported post | Open a direct permalink; feeds, profiles, share links, and embedded frames are not capture targets. |
| No unambiguous context | The adapter cannot safely isolate this page's post. Do not accept another card's text as a substitute. |
| Caption unavailable | Make the actual caption visible yourself and capture again. If it remains null, report the limitation; do not invent text. |
| Media available but AI unknown | Expected: a URL/blob reference is not verified accessible bytes, and processing permission is unverified. |
| Could not connect to extension | Use Chrome in the same profile, enable/reload the extension, open localhost on port 3000, or use JSON fallback. |
| Capture expired/already imported | Capture again; the handoff is one-time with a five-minute window. |
| Site navigated during capture | Wait for the desired post to settle and capture again. |

### Extension manual acceptance findings

On 2026-11-04, the user authorized testing the two supplied permalinks. The existing installed extension was reloaded, capture was explicitly clicked, and **Open in Memoar** imported each result through the real bridge in Dia. No server was started and no Next.js build was run. Fixture tests remain separate from these observations.

Tested URLs: [Instagram photo](https://www.instagram.com/p/DfSJbEzDXf5/) and [Threads video post](https://www.threads.com/@ceritaselamanya/post/DfRfWG_ElIu/). These results apply to the observed desktop layouts only. No caption or media payload is retained here.

| Platform / case | Actual fields | Missing fields | Media access | AI readiness | Limitation | Live date |
| --- | --- | --- | --- | --- | --- | --- |
| Instagram photo | 8 content fields: author handle/URL, caption, hashtags, media type, thumbnail/image references, timestamp | Post text, video/audio, location | Correct post image reference; profile/composer avatars excluded | Spark/SAM unknown; Voice blocked | Caption completeness unverified; no carousel claim | 2026-11-04 |
| Instagram Reel | Not tested | Unknown | Not tested | Not tested | Player does not establish video-file access | Not tested |
| Instagram carousel | Not tested | Unknown | Not tested | Not tested | Visible rendered slide only | Not tested |
| Threads video post | 7 content fields: author handle/URL, post text, hashtags, media type, video reference, timestamp | Caption, thumbnail/images, audio, location | Page-scoped blob video reference only | Spark/SAM unknown; Voice blocked | Text matched primary post; replies excluded; location not captured | 2026-11-04 |
| Facebook post | Not tested | Unknown | Not tested | Not tested | Best effort; no parity claim | Not tested |

Both captures imported with DOM provenance and permission unverified. Official embed frames appeared separately; this does not verify playback or make embed contents AI inputs. Still test feed refusal, unrelated page refusal, inaccessible content, expired captures, consumed captures, disabled extension, invalid JSON, copy feedback, and same-URL comparison. Record platform, URL type, observed fields, limits, and UTC test date; never commit private caption/media payloads. The existing URL-only regression checklist above still applies.

Chrome implementation references: [scripting and activeTab](https://developer.chrome.com/docs/extensions/reference/api/scripting), [web-page messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), [externally_connectable](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable), and [session storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

### Collaboration/modal follow-up (2026-11-04)

The user-supplied Instagram collab permalink ending `DXExtkWCYdb5cCZLZhAo2p26Qan8RceERUaSS00` was checked in Dia. Full-page capture preserved the linked caption and both collaboration accounts. A final capture through the profile modal imported 9 content fields, including caption, both accounts, visible location label, timestamp, and reference-only video. The audio label remained unavailable in that observation; scoped audio metadata support passed fixtures, with other live layouts unverified. Header labels can rotate or be clipped, so counts need not match across captures. The official preview service returned HTTP 400 for this URL; the exact cause and privacy/deletion status remain unknown. No caption/media payload is retained here.

### Ordered media capture

The extension's optional **Capture all carousel slides** checkbox authorizes bounded navigation of visible carousel controls. Capture starts from the first reachable slide, records positions in navigation order, and stops at the last observed endpoint. Explicit position/count labels are used where available. Ambiguous controls or media, repeated indistinguishable slides, unloaded slides, user interaction, hidden tabs, or limits leave `media.completeness: partial`. The last captured slide remains selected; capture never scrolls, starts playback, or opens tagged accounts.

`inspection.media` retains each observed slide's type, position, selected URL, local player reference, poster, dimensions, access state, reason, and optional image verification evidence. Composition is `image_only`, `video_only`, `mixed`, or `unknown`; unseen slides never establish a homogeneous carousel type. Existing fields remain available. Multiple video references live in ordered `media.items` instead of being collapsed into a misleading single `videoUrl`. Raw JSON and Copy JSON preserve this structure alongside the direct `data` field values.

`verified_accessible` image evidence requires an anonymous readable CORS response with an accepted image MIME type and decoded bytes. Network/CORS/time-limit failures remain `reference_only`; known denied/missing responses or non-image MIME responses can be marked `unavailable`. Verification reflects the capture time and browser context, not durable third-party access or permission to train/use AI. Video sources come only from visible `video`/`source` attributes. Blob URLs remain local references. Model format compatibility and processing permission remain unverified; neither a URL nor successful image verification makes an input AI-ready.

Local regression coverage includes tagged media slides, avatar/comment exclusion, clipped neighboring slides, mixed ordering, resolution selection, deduplication, unnumbered endpoint traversal, opt-in navigation, unloaded slides, post navigation, anonymous resource verification, and JSON/clipboard parity. Live desktop checks on 2026-11-04 confirmed a single image (JPEG 1080 × 1350), the supplied Reel (blob reference only with existing text/author/collaborator/date/audio fields retained), and the supplied image carousel (20/20 ordered image slides with decoded JPEG verification). Mixed-carousel and interrupted-load behavior passed isolated tests but have not been verified live. Computer use was stopped at the user's request to limit credit usage.

### Snapshot transport

After **Capture current post**, the extension may add a cropped static snapshot of the visible media. It uses the existing activeTab permission with Chrome's [captureVisibleTab API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab); no new permissions, uploads, media requests, scrolling, or playback actions are added. A viewport screenshot exists transiently inside the extension to perform the crop. Only the cropped JPEG survives into the short-lived capture session; neither the original screenshot nor pixels are sent to the inspector API.

Snapshot guards check source tab/window/URL, media source, viewport/scroll geometry, and overlay occlusion before and after taking pixels. Multiple visible media targets, moving/obscured content, unsupported screenshots, oversized images, and encoding failures leave an explicit unavailable reason while retaining the DOM report. The output's longest edge is at most 720 pixels, and its JPEG data URL is limited to 128 KiB of text within the existing 256 KiB envelope limit. Snapshot imports rebuild an allowlisted object, check JPEG headers/dimensions, and force unverified processing eligibility. Decode failures fall back to the original-post link.

The optional `snapshot` property is outside `inspection`. It travels through the same five-minute, one-time session and the extension's explicit **Copy captured JSON** transport fallback. The inspector's **Raw JSON / Copy JSON** exports only `inspection`, excluding snapshot pixels. Snapshots never become `thumbnailUrl`, `imageUrls`, or AI inputs. A missing thumbnail URL can therefore coexist with a working snapshot preview. Official preview failures remain in the inspection attempts.

**Preview** automatically shows **Captured snapshot** when official markup is unavailable or its SDK fails. If markup exists but the provider iframe cannot display content, use **Show captured snapshot**; **Show official embed** switches back. Playback remains available only through a working official embed or the original post. URL-only comparisons do not display the captured snapshot.

The Reels viewer has many recommendation cards in the DOM. Where no post permalink is rendered in the active card, capture requires one large, mostly visible player and a unique observed creator Reels-profile link inside a single-player container, together with the validated active permalink and navigation guards. This does not prove DOM/server identity independently; ambiguity stops capture. Mentioned profiles are not substituted for the creator. Caption/audio fields can still be unavailable if their visible text cannot be isolated safely.

Live check, 2026-11-04, Dia: the supplied `/reels/DVYYn2kkq6_rcgQ6wi2jZNJSKKFiwh_VrJiJ240/` link was accepted and normalized without changing its identifier. Capture and one-time import succeeded. A cropped media snapshot visibly appeared in Memoar when the official service returned HTTP 400, with static/unverified labels and no surrounding comments or navigation in the crop. Four content fields were captured (author handle/URL, media type, video reference). Caption, thumbnail URL, and audioLabel remained unavailable in that capture. A separate read of the source page identified the audio attribution as **Justin Bieber · I DO**, with link `https://www.instagram.com/reels/audio/1096536585924625/`; it was not inserted into the missing captured field. No screenshot, caption, or media payload is retained in this repository.

Remaining manual checks: other page sizes, carousel snapshots, iframe-only failures and the embed/snapshot toggle, JSON snapshot fallback, expired sessions with snapshots, tab movement during real capture, and other audio layouts. After building extension changes, close the popup and reload the installed extension before capturing again.

### Export Test Script

Each AI Readiness model has an **Export Test Script** action. Confirm permission to export the content first. Image URLs must pass the existing verified-input filter, then a fresh anonymous CORS read, MIME/signature checks, size limits, and image decoding. Any failed candidate aborts the export; an earlier accessible URL is never substituted for bytes. Unknown carousel ordering is rejected. Partial captures include only the known exported positions and print a warning at runtime.

In the local app, this action now writes directly to `export/<model>-<unique-id>/` in the project root instead of downloading a ZIP. Script and any local `media/` files are saved together; existing exports are never overwritten. The UI shows the directory and the exact `node export/.../test-....mjs` command to run from the project root. `export/` is excluded from Git. The same-origin loopback-only `/api/exports` route accepts bounded export files, writes only the selected model's script and media names, and never runs the script or calls a model API. This requires the existing local Memoar server; a remotely hosted/static copy cannot write into your project.

A single image up to 512 KiB is embedded as Base64 in a standalone `.mjs`. Larger images, carousel assets, and WAV audio are saved as local files in `media/` beside the script. No ZIP download or extraction is needed. Media hashes are checked before any API request. No CDN or blob URL is used by the exported scripts. Current script export supports JPEG/PNG/WebP images and user-selected WAV audio; video references are excluded because the capture does not establish reusable video bytes.

Run with Node.js 22+ from the project root, using the exact saved path shown by the UI. For example (replace `EXPORTED_ID` with the generated directory suffix):

```sh
node export/museSpark-EXPORTED_ID/test-muse-spark.mjs
node export/sam31-EXPORTED_ID/test-sam.mjs
node export/museVoiceTranscribe-EXPORTED_ID/test-muse-voice.mjs
```

Scripts call `process.loadEnvFile('.env.local')` and fall back to `.env` only when `.env.local` is absent. `MODEL_API_KEY` stays on the user's machine and is never embedded in the download. Muse Spark uses `POST https://api.meta.ai/v1/responses`, editable `REASONING_EFFORT = 'minimal'`, Base64 image inputs, and a strict content-enrichment JSON schema. SAM uses the same endpoint with the user's explicit target and one streamed segmentation request per ordered image. Both set `store: false`. Voice uses `POST https://api.meta.ai/v1/asr/transcribe` with native multipart `request` JSON and WAV `audio` parts; its export stays disabled until actual WAV sample bytes have been selected and validated.

Export itself does not call AI. Running a saved script sends the included content to Meta and can incur API usage. Captured caption/metadata are included as context; they are not instructions or a claim that model compatibility/processing permission has been independently verified. The scripts print formatted responses, parsed enrichment, token usage when supplied, and credential/media/API errors. API calls are not automatically retried.

References: [image inputs](https://dev.meta.ai/docs/image-understanding), [structured output](https://dev.meta.ai/docs/structured-output), [SAM prompts](https://dev.meta.ai/docs/sam/segmenting), [audio transcription](https://dev.meta.ai/docs/speech-to-text).

Muse Spark enrichment uses structured `objects` with `name`, generic `type`, `position: {slide, region}`, visible `attributes`, and `evidence: {source, text}`. Specific product names require an unambiguous readable label/object association or decisive visual evidence. `captionContext` separately records caption claims, product names, brands and locations; caption-only details do not enter visual observations. Search phrases may use relevant synonyms and natural-language wording without introducing unsupported facts. Unknown values stay null or empty. Text-only posts have empty visual fields; carousel positions refer only to supplied images. Reasoning stays `minimal`.

The prompt requests distinct complete OCR phrases instead of duplicates or overlapping fragments. The exported script's `Parsed result` additionally normalizes case/spacing duplicates and removes explicitly ellipsis-truncated fragments only when a complete recognized phrase is present. Distinct complete short labels, prices, units and variants remain intact. The raw API response is still printed separately. Re-export scripts to apply prompt/schema changes; previously saved scripts are not rewritten. Prompt adherence and visual recognition accuracy have not been evaluated with paid inference for this update.
