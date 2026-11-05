# Memoar

Save social posts to a local library and find them again through search, filters, and collections. Muse Spark automatically organizes captured content after each save.

## Tech stack

- Next.js 16, React 19, and TypeScript.
- Astryx and StyleX for the UI.
- Chrome Extension Manifest V3 for post capture.
- IndexedDB for the extension library and website cache.
- Meta Muse Spark 1.3 through a server-side API for content analysis.

## How to install

Requires Node.js 22+, npm, Chrome 112+, and a Meta API key for Muse Spark.

```sh
npm ci
cp .env.example .env.local
```

Fill in `.env.local`:

```dotenv
MODEL_API_KEY=your_meta_api_key
MEMOAR_ENRICHMENT_TOKEN=your_random_secret_at_least_24_characters
```

Both values stay on the server. `MEMOAR_ENRICHMENT_TOKEN` signs local access tokens; it is not a Meta API key. `NEXT_PUBLIC_MEMOAR_EXTENSION_ID` is optional because the extension can supply its ID when opening the website.

Build the extension and start the website:

```sh
npm run extension:build
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in the same Chrome profile as the extension. Use this exact address for the local connection. Restart the server after changing `.env.local`.

## Import the extension into Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the project's `extension/dist` folder.
3. Pin Memoar to the Chrome toolbar.
4. Click the Memoar icon on a web page, then choose **Your library** to connect the extension and import your library into the website.

If needed, copy the extension ID from `chrome://extensions` into the [setup page](http://localhost:3000/setup). After changing extension source, rebuild it, click **Reload** on its Chrome extension card, and refresh the social tab.

## How to use

1. Open a supported Instagram, Threads, or Facebook post with its content visible.
2. Click the Memoar icon, then **Add to Memoar**. Keep the post open during capture; carousels may move through slides.
3. Wait for **Saved to Memoar**, then click **Open in Memoar**. AI analysis runs in the background.
4. Find saved posts through Explore, filters, or collections. Open a post to see its captured content and AI results.

The website imports updates while the dashboard is active, about every 20 seconds. Use **Resync** to sync manually.

## Supported platforms

| Platform | Supported content / links |
| --- | --- |
| Instagram | Posts, carousels, and Reels (`/p/`, `/reel/`, `/reels/`). |
| Threads | Text and media posts (`/@handle/post/id`, `/t/id`), including the `threads.net` domain. |
| Facebook | Posts, Reels, videos, and watch links. Capture may be partial; video/watch previews fall back to the source link. |

Use direct post links. Profiles, Stories, share/short links, `permalink.php`, and `story.php` are not supported. Missing content stays marked as unavailable; a supported link does not guarantee that all media can be captured.

## Muse Spark flow

1. The extension captures available post content from the open page after you click save.
2. Content is saved to the extension's IndexedDB first, then automatically queued for analysis without an AI toggle.
3. The website pairs the extension with the local API. The extension worker sends captured text and validated media to `/api/enrich`; the server forwards them to Muse Spark 1.3 using the server-side API key.
4. Muse Spark returns categories, topics, per-slide summaries, visible text, objects, brands, and search keywords based on the supplied inputs. Analysis is text-only when media is unavailable.
5. Results are stored in the extension and synced to the website for search and related posts. Searching does not make additional AI calls.

Keep the local server running for analysis. Retryable jobs get up to three attempts; failed analysis leaves the saved post intact, with a retry action in its details. Preview snapshots and oEmbed metadata are display-only and never enter AI inputs.

## Storage and limitations

- The main library lives in the Chrome profile where the extension is installed. The website keeps a cache; there is no cloud sync or server database.
- Analysis sends available content to Meta and may use API quota. Only save content you are authorized to process, and review AI results.
- Full videos are not archived permanently. Metadata exports exclude original media files and are not complete backups.
- Removing the extension or clearing browser storage can erase the library. This MVP runs locally; production deployment and enrichment hosting are not configured.
