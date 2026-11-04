# Memoar / Post Inspector

- Keep changes within the approved inspection prototype and user-triggered Chrome extension capture. One-time visible DOM reads and short-lived chrome.storage.session handoff are authorized. No server scraping, private APIs, OAuth, permanent storage, uploads, AI inference, or deployment.
- Do not start the app, run a Next.js build/server, use a browser, or perform live post/API tests. The user checks those manually. Typecheck, isolated unit tests, and building the extension are authorized.
- Preserve the fixed dark appearance. Use actual Astryx components, neutral theme tokens, and small StyleX `xstyle` adjustments. Native semantic markup and scoped layout CSS are used for the inspection report.
- oEmbed is display-only. Never promote its author/text/media metadata into extracted fields or AI inputs. Keep display HTML outside exported inspection JSON.
- Missing content, permissions, and unverified rendering must remain explicit. Do not infer privacy, deletion, authors, or media type from URL shapes or generic errors.
- Run `npm run typecheck` and `npm test` for relevant changes. Tests must inject provider transports; live fetch is blocked by the test setup.

## Astryx

The project uses CLI-generated `src/astryx-themes.ts` and published production CSS. Use `Theme` with `mode="dark"` and preserve the initial HTML theme attributes.

Read actual imports and props before using a component:

```sh
npm run astryx -- component <Name>
npm run astryx -- docs tokens
npm run astryx -- docs theme
```

Use the local scoped CLI through the npm script. Do not install it globally. Preserve the user-defined single-page layout rather than substituting a generic dashboard template.
