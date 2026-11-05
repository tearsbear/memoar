# Memoar

Save social posts to a local library and find them again through search, filters, and collections. Muse Spark automatically organizes captured content after each save.

Website: [memoar-theta.vercel.app](https://memoar-theta.vercel.app). To get started, download the extension from the [install guide](https://memoar-theta.vercel.app/getting-started#install), then connect your browser. No local server is needed when using the hosted website.

## Tech stack

- Next.js 16, React 19, and TypeScript.
- Astryx and StyleX for the UI.
- Chrome Extension Manifest V3 for post capture.
- IndexedDB for the extension library and website cache.
- Meta Muse Spark 1.3 through a server-side API for content analysis.

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

Build an extension targeting the local server and start the website:

```sh
MEMOAR_EXTENSION_ORIGIN=http://localhost:3000 npm run extension:build
npm run dev
```

The extension build creates `extension/dist` and `extension/memoar-extension.zip`. Without the origin override, it targets `https://memoar-theta.vercel.app`. Rebuild after changing extension source.

Open [http://localhost:3000](http://localhost:3000) in the same Chrome profile as the extension. Use this exact address for the local connection. Restart the server after changing `.env.local`.

## Vercel deployment

1. Run `npm run extension:build` without the local origin override to create the hosted extension ZIP.
2. Commit the source changes and `extension/memoar-extension.zip`, then push them to the repository connected to Vercel. Next.js explicitly includes the ZIP in the download endpoint's deployment bundle.
3. Set `MODEL_API_KEY` and `MEMOAR_ENRICHMENT_TOKEN` in Vercel's production environment variables. Keep both server-only; the signing secret must be at least 24 characters.
4. Use `npm run build` as the Vercel build command, deploy to `https://memoar-theta.vercel.app`, and redeploy after environment changes.

The extension allows only this hosted domain and `http://localhost:3000`. Preview deployment domains are not connected. Downloading an updated ZIP does not update an already-installed unpacked extension automatically.

## Import the extension into Chrome

1. Click **Download extension ZIP** in the [install guide](https://memoar-theta.vercel.app/getting-started#install) or on the setup page. Your browser saves it to your default download folder (usually Downloads), or asks you to choose a location if that setting is enabled.
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
3. The website pairs the extension with its API. The extension worker sends captured text and validated media to `/api/enrich` on its configured Memoar origin; the server forwards them to Muse Spark 1.3 using the server-side API key.
4. Muse Spark returns categories, topics, per-slide summaries, visible text, objects, brands, and search keywords based on the supplied inputs. Analysis is text-only when media is unavailable.
5. Results are stored in the extension and synced to the website for search and related posts. Searching does not make additional AI calls.

The API must be configured and reachable for analysis. For local development, keep the local server running. Retryable jobs get up to three attempts; failed analysis leaves the saved post intact, with a retry action in its details. Preview snapshots and oEmbed metadata are display-only and never enter AI inputs.

## Storage and limitations

- The main library lives in the Chrome profile where the extension is installed. The website keeps a cache; there is no cloud sync or server database.
- Analysis sends available content to Meta and may use API quota. Only save content you are authorized to process, and review AI results.
- Full videos are not archived permanently. Metadata exports exclude original media files and are not complete backups.
- Removing the extension or clearing browser storage can erase the library. Local and hosted website caches are separate; the extension remains the main library.
- Hosted AI requests are capped at 4 MiB including captured text and all attached media, below [Vercel's 4.5 MB payload limit](https://vercel.com/docs/functions/limitations). Larger posts remain saved but cannot be analyzed through this endpoint; large video uploads are not supported on the hosted API.
- The AI concurrency and hourly limits apply per server instance, not across all Vercel instances. This is a demo without account-based usage quotas.
