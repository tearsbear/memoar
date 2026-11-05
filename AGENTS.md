# Memoar MVP

- The user approved the local-first MVP on 2026-11-05: extension IndexedDB library, website cache, user-triggered capture, and automatic Muse Spark enrichment (approved by the user; no AI toggle) through a server-only API. Preserve the proven capture adapters, prompt, export paths, and media validation. No server scraping, private APIs, OAuth, cloud database, or deployment.
- Do not run a browser, server, build (including extension build), tests, or live post/API checks. The user handles these manually. Static syntax checks and `npm run typecheck` are authorized.
- Use the approved light-only Memoar identity, Memoar Blue, Bricolage Grotesque / Inter, floating navigation rail, and bottom search. Keep actual Astryx components and scoped layout CSS; adapt the generic DESIGN.md to the Memoar implementation plan.
- oEmbed is display-only. Never promote its author/text/media metadata into extracted fields or AI inputs. Keep display HTML outside exported inspection JSON.
- Missing content, permissions, and unverified rendering must remain explicit. Do not infer privacy, deletion, authors, or media type from URL shapes or generic errors.
- Run `npm run typecheck` for relevant changes. Do not run tests in this task. If later authorized, tests must inject provider transports; live fetch is blocked by the test setup.

## Astryx

The project uses CLI-generated `src/astryx-themes.ts` and published production CSS. Use `Theme` with `mode="light"` and preserve matching initial HTML theme attributes.

Read actual imports and props before using a component:

```sh
npm run astryx -- component <Name>
npm run astryx -- docs tokens
npm run astryx -- docs theme
```

Use the local scoped CLI through the npm script. Do not install it globally. Preserve the requested Memoar layouts rather than substituting a generic dashboard template.
