# Memoar

Save social posts to a local library and find them again through search, filters, and collections. Muse Spark automatically organizes captured content after each save.

Hosted demo: [memoar-theta.vercel.app](https://memoar-theta.vercel.app).

**Run Memoar locally for now**, especially when analyzing videos or larger carousels. Local use needs fewer services. Hosted media processing now uses private Vercel Blob transit storage, which must be configured and manually verified after deployment. Neither mode permanently archives videos or guarantees that every post can be captured or analyzed.

## Local vs hosted

| | Local (recommended) | Hosted demo |
| --- | --- | --- |
| Website | `http://localhost:3000` | `https://memoar-theta.vercel.app` |
| Server | Keep `npm run dev` running | Runs on Vercel; no local server needed |
| Extension build | Set `MEMOAR_EXTENSION_ORIGIN=http://localhost:3000` | Default `npm run extension:build` |
| AI input limit | 53 MiB total | 53 MiB via private Blob; API request bodies remain capped at 4 MiB |
| Large-media transit | Extension → local server → Meta | Extension → private Blob → server → Meta |
| API credentials | Your `.env.local` | Deployment owner's server-side Vercel variables |

Both modes keep the main library in the extension's Chrome profile and send supported AI inputs to Meta. Local mode still needs internet for Meta APIs. Website caches are separate, and starting a local website does not change an installed extension's target URL.

## Tech stack

- Next.js 16, React 19, and TypeScript.
- Astryx and StyleX for the UI.
- Chrome Extension Manifest V3 for post capture.
- IndexedDB for the extension library and website cache.
- Meta Muse Spark 1.3 through a server-side API for content analysis.
- Vercel Blob for private temporary media uploads on the hosted version.

## Local development

Requires Node.js 22+, npm, Chrome 112+, the `zip` command (included on macOS; install it on other systems if missing), and a Meta API key for Muse Spark.

```sh
npm ci
cp .env.example .env.local
```

Fill in `.env.local`:

```dotenv
MODEL_API_KEY=your_meta_api_key
MEMOAR_ENRICHMENT_TOKEN=your_random_secret_at_least_24_characters
```

Both values stay on the server. `MEMOAR_ENRICHMENT_TOKEN` signs access tokens; it is not a Meta API key. `NEXT_PUBLIC_MEMOAR_EXTENSION_ID` is optional because the extension can supply its ID when opening the website.

Open a terminal in this project folder and run these commands in order. If the local server is already running, stop it with Ctrl+C first:

```sh
MEMOAR_EXTENSION_ORIGIN=http://localhost:3000 npm run extension:build
npm run dev
```

The extension build creates `extension/dist` and `extension/memoar-extension.zip`. Without the origin override, it targets `https://memoar-theta.vercel.app`. Rebuild after changing extension source.

Keep that terminal running. In Chrome, open `chrome://extensions` and click **Reload** on Memoar if it was loaded from this project's `extension/dist`. For a first install, enable **Developer mode**, click **Load unpacked**, and select `extension/dist`. If you installed from an extracted ZIP, update that folder with the new local build before reloading it.

Open [http://localhost:3000](http://localhost:3000) in the same Chrome profile as the extension, then connect through **Your library** or the local `/setup` page. **Open in Memoar** should now open localhost. Restart the server after changing `.env.local`.

## Vercel deployment

1. Run `npm run extension:build` without the local origin override to create the hosted extension ZIP.
2. Commit the source changes and `extension/memoar-extension.zip`, then push them to the repository connected to Vercel. Next.js explicitly includes the ZIP in the download endpoint's deployment bundle.
3. Set `MODEL_API_KEY` and `MEMOAR_ENRICHMENT_TOKEN` in Vercel's production environment variables. Keep both server-only; the signing secret must be at least 24 characters.
4. In the Vercel project's **Storage** section, create/connect a **private Blob store**. Ensure its `BLOB_READ_WRITE_TOKEN` is available to the Production environment. Do not use a public store or put this secret in `NEXT_PUBLIC_` variables.
5. Add a random server-only `CRON_SECRET` for the daily cleanup job configured in `vercel.json`.
6. Use `npm run build` as the Vercel build command, deploy to `https://memoar-theta.vercel.app`, and redeploy after environment changes. Rebuild/reinstall or reload extension version 0.3.0 and approve the added Blob upload host permissions.

The implementation is source-checked, not live-verified. Manually verify an image, a video above 4 MiB, AI completion, temporary-file deletion, and the cleanup cron after deployment. Blob storage and transfer may incur charges. Local mode continues to work without Blob credentials.

The extension allows only this hosted domain and `http://localhost:3000`. Preview deployment domains are not connected. Downloading an updated ZIP does not update an already-installed unpacked extension automatically.

## Import the extension into Chrome

1. For local use, follow the steps above or download the ZIP from your local `/setup` page after building for localhost. For the hosted demo, use its [install guide](https://memoar-theta.vercel.app/getting-started#install). Your browser saves the ZIP to your default download folder (usually Downloads), or asks for a location if that setting is enabled.
2. Extract `memoar-extension.zip` into a folder you will keep.
3. Open `chrome://extensions` and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`, not the ZIP file. Developers can also select `extension/dist` directly.
5. Pin Memoar to the Chrome toolbar.
6. Click the Memoar icon on a web page, then choose **Your library** to connect the extension and import your library into the website.

If needed, copy the extension ID from `chrome://extensions` into the [setup page](https://memoar-theta.vercel.app/setup) (or `/setup` on your local server). After an update, download the rebuilt ZIP and replace the files in the same extracted folder, click **Reload** on its Chrome extension card, approve any new permissions, and refresh the social tab. If the download says the ZIP is not ready, the project owner needs to build and include it before redeploying.

## How to use

1. Open a supported Instagram, Threads, or Facebook post with its content visible.
2. Click the Memoar icon, then **Add to Memoar**. Keep the post open during capture; carousels may move through slides.
3. Wait for **Saved to Memoar**, then click **Open in Memoar**. AI analysis runs in the background.
4. Find saved posts through Explore, filters, or collections. Open a post to see its captured content and AI results.

The website imports updates while the dashboard is active, about every 20 seconds. Use **Resync** to sync manually.

## Supported platforms

| Platform  | Supported content / links                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Instagram | Posts, carousels, and Reels (`/p/`, `/reel/`, `/reels/`).                                                         |
| Threads   | Text and media posts (`/@handle/post/id`, `/t/id`), including the `threads.net` domain.                           |
| Facebook  | Posts, Reels, videos, and watch links. Capture may be partial; video/watch previews fall back to the source link. |

Use direct post links. Profiles, Stories, share/short links, `permalink.php`, and `story.php` are not supported. Missing content stays marked as unavailable; a supported link does not guarantee that all media can be captured.

## Muse Spark flow

1. The extension captures available post content from the open page after you click save.
2. Content is saved to the extension's IndexedDB first, then automatically queued for analysis without an AI toggle.
3. The website pairs the extension with its API. Locally, text and validated media go directly to `/api/enrich`. Large hosted media goes directly to private Blob using short-lived, file-specific upload tokens; only captured context and signed file references go to `/api/enrich`. The server checks the stored media size and SHA-256 before forwarding inputs to Muse Spark 1.3. The Meta key and Blob read-write token stay on the server.
4. Muse Spark returns categories, topics, per-slide summaries, visible text, objects, brands, and search keywords based on the supplied inputs. Analysis is text-only when media is unavailable.
5. Results are stored in the extension and synced to the website for search and related posts. Searching does not make additional AI calls.

The API must be configured and reachable for analysis. For local development, keep the local server running. Retryable jobs get up to three attempts; failed analysis leaves the saved post intact. Upload-size failures stop automatic retries and explain that retrying unchanged will not help. Retry is unavailable for a current size-limit failure on the same server. Older 4 MiB failures can be retried after updating the extension and configuring private Blob. Missing Blob configuration stops automatic retries and explains what the project owner must configure. Temporary video input may expire after 24 hours. Preview snapshots and oEmbed metadata are display-only and never enter AI inputs.

### Example input and output

Illustrative example, not a recorded API result: one captured slide shows an empty-state design with the readable phrases “Add a clear next step” and “Add your first item.” The caption says “Use one primary action in an empty state.”

**Input to Muse Spark** (`POST https://api.meta.ai/v1/responses`, abridged):

```json
{
  "model": "muse-spark-1.3",
  "store": false,
  "reasoning": { "effort": "low" },
  "max_output_tokens": 8192,
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "<enrichmentPrompt>\nCapture is limited to supplied content.\nCaptured context: {\"caption\":\"Use one primary action in an empty state.\",\"authorHandle\":null}\nMP4 audio-track evidence (presence does not establish speech): []"
        },
        { "type": "input_text", "text": "Slide position: 1" },
        { "type": "input_image", "image_url": "data:image/jpeg;base64,<verified-image-bytes>" }
      ]
    }
  ]
}
```

`<enrichmentPrompt>` and `<verified-image-bytes>` are documentation placeholders. The actual request also includes `text.format` with `type: "json_schema"`, `name: "content_enrichment"`, `strict: true`, and the full [enrichment schema](src/lib/inspection/enrichment.ts). That schema is omitted above for readability. The [API route](src/app/api/enrich/route.ts) assembles the request; the [prompt](src/lib/inspection/enrichment.ts) separates visual observations from caption claims and requires unknown values to stay `null` or empty.

For video, the server uploads verified MP4 bytes to Meta Files first and supplies `{ "type": "input_video", "file_id": "<Meta-file-id>" }` instead of an image data URL. Each media item keeps its captured slide position. Private Blob URLs, upload tickets, preview snapshots, and oEmbed metadata are not sent as model inputs.

**Parsed output** (illustrative, matching the schema):

```json
{
  "category": "UX design",
  "topics": ["Empty states", "Calls to action"],
  "visualDescription": "An empty-state interface with a button and an annotation pointing to its next action.",
  "slides": [
    {
      "position": 1,
      "summary": "The slide recommends giving an empty state a clear next action.",
      "keyInsights": ["The example button is labelled Add your first item."]
    }
  ],
  "objects": [
    {
      "name": null,
      "type": "empty-state panel",
      "position": { "slide": 1, "region": "center" },
      "attributes": [],
      "evidence": [
        { "claim": "empty-state panel", "source": "visual", "text": null },
        { "claim": "center", "source": "visual", "text": null }
      ]
    }
  ],
  "brands": [],
  "visibleText": ["Add a clear next step", "Add your first item"],
  "rawVisibleText": ["Add a clear next step", "Add your first item"],
  "visualKeywords": ["empty-state panel", "button", "annotation"],
  "searchableKeywords": ["empty state with a clear next action", "primary action in an empty state"],
  "captionContext": { "summary": null, "productNames": [], "locations": [] }
}
```

The server parses the model's JSON, validates it against the schema, and cleans duplicate search-facing OCR in `visibleText`, leaving `rawVisibleText` unchanged. It returns an NDJSON result event containing `type: "result"`, `ok: true`, `enrichment` (the object above), and `inputNote` describing the actual input coverage. The extension validates the result again and stores it with the model name and coverage note. These fields support lexical search and related-post matching; no new AI call is made when searching. Text-only results have empty visual fields rather than invented media observations.

## Upload-size errors

Small hosted requests keep the existing direct-upload path and do not require Blob. Larger uploads automatically use private Blob; missing storage configuration produces an actionable error without automatic retries.

Local multipart requests and hosted staged inputs are limited to 53 MiB, including captured context and all attached media. Existing per-file capture/format checks still apply. Retrying an unchanged post above this limit will not help.

[Vercel's 4.5 MB request limit](https://vercel.com/docs/functions/limitations) still applies to API request bodies. For larger media, the new hosted extension sends only a small manifest to the API and uploads media directly to Blob, avoiding that bottleneck. If an older extension still gets the 4 MiB error, rebuild/reload it and retry after configuring private Blob. Temporary video input may already have expired; this change does not restore deleted media.

The server and extension attempt to delete staged files after each processing attempt. A daily cron removes files older than 24 hours under the dedicated `memoar-ai/` prefix, including uploads abandoned by an interrupted worker. Cleanup is best-effort: files can remain longer if deletion, cron authentication, or the scheduled invocation fails. Check the Blob store and cron logs after deployment.

## Storage and limitations

- The main library lives in the Chrome profile where the extension is installed. The website keeps a cache; there is no cloud sync or server database.
- Analysis sends available content to Meta and, on hosted builds, through private temporary Blob storage. It may use API and storage/transfer quota. Only save content you are authorized to process, and review AI results.
- Full videos are not archived permanently. Metadata exports exclude original media files and are not complete backups.
- Removing the extension or clearing browser storage can erase the library. Local and hosted website caches are separate; the extension remains the main library.
- Temporary Blob files are only for AI transit, not permanent video archives or playback. No cloud library or cloud sync is added.
- The AI concurrency and hourly limits apply per server instance, not across all Vercel instances. This is a demo without account-based usage quotas.
