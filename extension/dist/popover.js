"use strict";
(() => {
  // extension/popup.html
  var popup_default = '<!doctype html>\n<html lang="en">\n  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Memoar</title><link rel="stylesheet" href="popup.css"></head>\n  <body><main>\n    <header><img src="memoar-icon.png" width="38" height="38" alt=""><span class="brand">memoar</span><button id="library" class="text-button">Your library \u2197</button></header>\n    <div class="post-context"><p class="platform-heading"><img id="platform-icon" width="16" height="16" alt="" hidden><span id="platform">Checking this tab\u2026</span></p><p id="page-url" class="url"></p></div>\n    <p id="status" role="status" aria-live="polite"></p>\n    <section id="saving-state" class="saving-state" role="status" hidden><span class="saving-spinner" aria-hidden="true"></span><div><strong>Saving your post\u2026</strong><p>Keep the post open. Your save comes first; organizing runs in the background.</p></div></section>\n    <button id="capture" class="primary" disabled>Add to Memoar</button>\n    <button id="open" class="primary" hidden>Open in Memoar</button>\n    <p class="note">Saved on this browser profile. Muse Spark organizes your saved text and supported media in the background. Only save content you\u2019re authorized to process.</p>\n  </main><script src="popup.js"><\/script></body>\n</html>\n';

  // extension/popup.css
  var popup_default2 = ':root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #12171c; background: #f6f8fa; }\n* { box-sizing: border-box; }\nbody { margin: 0; width: 360px; }\nmain { padding: 24px; }\nheader { display: flex; align-items: center; gap: 9px; margin-bottom: 30px; }\nheader img { border-radius: 11px; }\n.brand { font-size: 24px; font-weight: 650; letter-spacing: -1.2px; }\nbutton { font: inherit; cursor: pointer; }\n.text-button { margin-left: auto; padding: 8px 0; background: none; border: 0; font-size: 12px; color: #4d626d; }\n.post-context { padding: 14px 16px; margin-bottom: 20px; background: #fff; border-radius: 18px; }\n.platform-heading { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 13px; font-weight: 600; }\n.platform-heading img { flex-shrink: 0; }\n.url { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: #566570; }\n#status { margin: 0; font-size: 14px; line-height: 1.5; color: #4e616e; }\n#status:not(:empty) { margin-bottom: 18px; }\n.primary { width: 100%; border: 0; border-radius: 999px; background: #30779d; color: white; padding: 15px 20px; font-weight: 600; }\n.primary:hover { background: #286787; }\nbutton:disabled { opacity: .55; cursor: wait; }\n.note { font-size: 11px; line-height: 1.6; color: #596973; margin: 18px 0 0; }\n:focus-visible { outline: 3px solid #3c89b3; outline-offset: 4px; }\n[hidden] { display: none !important; }\n.saving-state { display: flex; gap: 12px; align-items: flex-start; padding: 18px; background: #e5f2f8; border-radius: 18px; }\n.saving-state strong { font-size: 14px; }\n.saving-state p { margin: 7px 0 0; font-size: 12px; line-height: 1.6; color: #435f70; }\n.saving-spinner { flex-shrink: 0; width: 18px; height: 18px; margin-top: 2px; border: 2px solid #afcedf; border-top-color: #30779d; border-radius: 50%; animation: saving-spin 1s linear infinite; }\n@keyframes saving-spin { to { transform: rotate(360deg); } }\n@media (prefers-reduced-motion: reduce) { .saving-spinner { animation: none; } }\n';

  // extension/memoar-icon.png
  var memoar_icon_default = "data:image/png;base64,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aJG+tcq1/ttLAABomZgF6MuJgOd+cVLrv6UEAICWiVmAF175+9J1RwYr/3PvXym0kwAA0ELH3jjf6dsBj518V+u/5QQAgJY6NP1mJ7cCYtV/+MQ7hXYTAABa6toAXbe2AuJ/c+z7034CAECLxVZAVy4IiuL/7MuvG/rrCAEAoOUOn3i7zLZ8mE7x7x4BAKADDrz0WmuLq+LfTQIAQAfE0cA2Ftk4qbD/xRnFv4MEAICOGK6027IdEEf9Drz8Wrn62ReF7hEAADokQkBsBzQ5GBgF/6fH33TUr+PuKgB0SmwHxGDgpQgDT24p4xQt/7ifQMu/+wQAgI6KI4Iz5y6XA7u3lKnJdWWUouBH4e/y7YR83Td2/eyXfywAdNqerQ+VZ3ZuLhNr7it1Gr7m5znf/hEAAHpkanKiCgPx43LFHn8MGh559awVf4/ZAgDokZnZueoTnYDtGx4o2x/+x2XT2tVlcvBZyLDgxx3+M+fmqp+b7O8/HQCAJNbfYnvg48+/UOyT0gEASOKSyX3mcQ8AACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACQkAABAQgIAACT0/wGNrXW4TsmMBwAAAABJRU5ErkJggg==";

  // public/platforms/instagram.svg
  var instagram_default = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-instagram" viewBox="0 0 16 16">\n  <path d="M8 0C5.829 0 5.556.01 4.703.048 3.85.088 3.269.222 2.76.42a3.9 3.9 0 0 0-1.417.923A3.9 3.9 0 0 0 .42 2.76C.222 3.268.087 3.85.048 4.7.01 5.555 0 5.827 0 8.001c0 2.172.01 2.444.048 3.297.04.852.174 1.433.372 1.942.205.526.478.972.923 1.417.444.445.89.719 1.416.923.51.198 1.09.333 1.942.372C5.555 15.99 5.827 16 8 16s2.444-.01 3.298-.048c.851-.04 1.434-.174 1.943-.372a3.9 3.9 0 0 0 1.416-.923c.445-.445.718-.891.923-1.417.197-.509.332-1.09.372-1.942C15.99 10.445 16 10.173 16 8s-.01-2.445-.048-3.299c-.04-.851-.175-1.433-.372-1.941a3.9 3.9 0 0 0-.923-1.417A3.9 3.9 0 0 0 13.24.42c-.51-.198-1.092-.333-1.943-.372C10.443.01 10.172 0 7.998 0zm-.717 1.442h.718c2.136 0 2.389.007 3.232.046.78.035 1.204.166 1.486.275.373.145.64.319.92.599s.453.546.598.92c.11.281.24.705.275 1.485.039.843.047 1.096.047 3.231s-.008 2.389-.047 3.232c-.035.78-.166 1.203-.275 1.485a2.5 2.5 0 0 1-.599.919c-.28.28-.546.453-.92.598-.28.11-.704.24-1.485.276-.843.038-1.096.047-3.232.047s-2.39-.009-3.233-.047c-.78-.036-1.203-.166-1.485-.276a2.5 2.5 0 0 1-.92-.598 2.5 2.5 0 0 1-.6-.92c-.109-.281-.24-.705-.275-1.485-.038-.843-.046-1.096-.046-3.233s.008-2.388.046-3.231c.036-.78.166-1.204.276-1.486.145-.373.319-.64.599-.92s.546-.453.92-.598c.282-.11.705-.24 1.485-.276.738-.034 1.024-.044 2.515-.045zm4.988 1.328a.96.96 0 1 0 0 1.92.96.96 0 0 0 0-1.92m-4.27 1.122a4.109 4.109 0 1 0 0 8.217 4.109 4.109 0 0 0 0-8.217m0 1.441a2.667 2.667 0 1 1 0 5.334 2.667 2.667 0 0 1 0-5.334"/>\n</svg>';

  // public/platforms/threads.svg
  var threads_default = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-threads" viewBox="0 0 16 16">\n  <path d="M6.321 6.016c-.27-.18-1.166-.802-1.166-.802.756-1.081 1.753-1.502 3.132-1.502.975 0 1.803.327 2.394.948s.928 1.509 1.005 2.644q.492.207.905.484c1.109.745 1.719 1.86 1.719 3.137 0 2.716-2.226 5.075-6.256 5.075C4.594 16 1 13.987 1 7.994 1 2.034 4.482 0 8.044 0 9.69 0 13.55.243 15 5.036l-1.36.353C12.516 1.974 10.163 1.43 8.006 1.43c-3.565 0-5.582 2.171-5.582 6.79 0 4.143 2.254 6.343 5.63 6.343 2.777 0 4.847-1.443 4.847-3.556 0-1.438-1.208-2.127-1.27-2.127-.236 1.234-.868 3.31-3.644 3.31-1.618 0-3.013-1.118-3.013-2.582 0-2.09 1.984-2.847 3.55-2.847.586 0 1.294.04 1.663.114 0-.637-.54-1.728-1.9-1.728-1.25 0-1.566.405-1.967.868ZM8.716 8.19c-2.04 0-2.304.87-2.304 1.416 0 .878 1.043 1.168 1.6 1.168 1.02 0 2.067-.282 2.232-2.423a6.2 6.2 0 0 0-1.528-.161"/>\n</svg>';

  // public/platforms/facebook.svg
  var facebook_default = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-facebook" viewBox="0 0 16 16">\n  <path d="M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951"/>\n</svg>';

  // src/lib/inspection/parse-url.ts
  var UrlValidationError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
      this.name = "UrlValidationError";
    }
    code;
  };
  var hosts = {
    "instagram.com": "instagram",
    "www.instagram.com": "instagram",
    "threads.com": "threads",
    "www.threads.com": "threads",
    "threads.net": "threads",
    "www.threads.net": "threads",
    "facebook.com": "facebook",
    "www.facebook.com": "facebook",
    "m.facebook.com": "facebook"
  };
  var tracking = /^(utm_.+|igsh|igshid|fbclid|mibextid|ref|refsrc|__tn__|__cft__|hl|locale)$/i;
  var secret = /token|password|authorization|signature|secret|api[_-]?key|cookie/i;
  function parsePostUrl(input) {
    if (typeof input !== "string" || input.trim().length === 0 || input.length > 2048) {
      throw new UrlValidationError("invalid_url", "Paste one post URL, up to 2,048 characters.");
    }
    const inputUrl = input.trim();
    let url;
    try {
      url = new URL(inputUrl);
    } catch {
      throw new UrlValidationError("invalid_url", "Enter a complete HTTPS post URL.");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port || /[\\\s\u0000-\u001f]/u.test(inputUrl)) {
      throw new UrlValidationError("invalid_url", "Use HTTPS without credentials, backslashes, spaces, or a custom port.");
    }
    const platform = Object.hasOwn(hosts, url.hostname) ? hosts[url.hostname] : void 0;
    if (!platform) {
      throw new UrlValidationError("unsupported_host", "Use an Instagram, Threads, or Facebook post URL.");
    }
    for (const key of url.searchParams.keys()) {
      if (secret.test(key)) throw new UrlValidationError("invalid_url", "Remove credentials or secret parameters from the URL.");
    }
    let path = url.pathname;
    let postId;
    let route = "post";
    let previewSupported = true;
    if (platform === "instagram") {
      const match = /^\/(?:([A-Za-z0-9_.]+)\/)?(p|reels?)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      postId = match?.[3];
      if (match) path = `/${match[1] ? `${match[1]}/` : ""}${match[2] === "reels" ? "reel" : match[2]}/${match[3]}/`;
    } else if (platform === "threads") {
      const match = /^\/(?:@[A-Za-z0-9_.]+\/post|t)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      postId = match?.[1];
    } else {
      const post = /^\/[A-Za-z0-9_.-]+\/posts\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      const reel = /^\/reel\/(\d+)\/?$/.exec(path);
      const video = /^\/[A-Za-z0-9_.-]+\/videos\/(\d+)\/?$/.exec(path);
      if (post) postId = post[1];
      else if (reel || video) {
        postId = (reel || video)[1];
        route = "video";
        previewSupported = Boolean(reel);
      } else if (/^\/watch\/?$/.test(path)) {
        const values = url.searchParams.getAll("v");
        if (values.length === 1 && /^\d+$/.test(values[0])) postId = values[0];
        route = "video";
        previewSupported = false;
      }
    }
    if (!postId) {
      throw new UrlValidationError("unsupported_path", "This link pattern is not supported. Use a direct post, Reel, or supported video link.");
    }
    for (const key of [...url.searchParams.keys()]) {
      if (tracking.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.hostname = platform === "threads" ? "www.threads.com" : `www.${platform}.com`;
    url.pathname = path.endsWith("/") ? path : `${path}/`;
    url.searchParams.sort();
    return { platform, inputUrl, normalizedUrl: url.toString(), postId, route, previewSupported };
  }

  // extension/popup-ui.ts
  function mountPopup(root, pageUrl, icons) {
    const save = root.querySelector("#capture");
    const open = root.querySelector("#open");
    const status = root.querySelector("#status");
    const loading = root.querySelector("#saving-state");
    let savedId = null;
    function saved(id, duplicate) {
      savedId = id;
      open.hidden = false;
      save.hidden = true;
      status.textContent = duplicate ? "Already in Memoar." : "Saved to Memoar. Open your library to explore it.";
    }
    async function initialize() {
      let parsed;
      try {
        parsed = parsePostUrl(pageUrl);
      } catch {
        root.querySelector("#platform").textContent = "No supported post";
        status.textContent = "Open a supported Instagram, Threads, or Facebook post to save it.";
        return;
      }
      root.querySelector("#platform").textContent = parsed.platform.charAt(0).toUpperCase() + parsed.platform.slice(1);
      const icon = root.querySelector("#platform-icon");
      icon.src = icons[parsed.platform];
      icon.hidden = false;
      const url = root.querySelector("#page-url");
      url.textContent = parsed.normalizedUrl;
      url.title = parsed.normalizedUrl;
      status.textContent = parsed.platform === "facebook" ? "Facebook capture may be partial. Only available post content is saved." : "";
      const response = await chrome.runtime.sendMessage({ type: "FIND_SAVED", url: parsed.normalizedUrl });
      if (!response?.ok) throw new Error(response?.error || "Could not check your saved posts. Reopen Memoar to retry.");
      if (response.result?.post) {
        if (response.result.post.id !== `${parsed.platform}:${parsed.postId}`) throw new Error("The saved result belongs to a different post. Reopen Memoar to check this post again.");
        saved(response.result.post.id, true);
      }
      save.disabled = false;
    }
    save.addEventListener("click", () => {
      save.disabled = true;
      save.textContent = "Saving your post\u2026";
      save.hidden = true;
      open.hidden = true;
      loading.hidden = false;
      status.textContent = "";
      void chrome.runtime.sendMessage({ type: "SAVE_POST", url: pageUrl }).then((response) => {
        if (!response?.ok || !response.result?.postId) throw new Error(response?.error ?? "Couldn\u2019t save this post. Try again.");
        saved(response.result.postId, response.result.duplicate === true);
      }).catch((error) => {
        status.textContent = error instanceof Error ? error.message : "Couldn\u2019t save this post. Try again.";
        save.textContent = "Try saving again";
      }).finally(() => {
        loading.hidden = true;
        save.disabled = false;
        save.hidden = Boolean(savedId);
      });
    });
    function openLibrary(detail) {
      void chrome.runtime.sendMessage({ type: "OPEN_LIBRARY", postId: detail ? savedId : null }).then((response) => {
        if (!response?.ok) throw new Error("Couldn\u2019t open Memoar. Try again.");
      }).catch(() => {
        status.textContent = "Couldn\u2019t open Memoar. Try again.";
      });
    }
    open.addEventListener("click", () => openLibrary(true));
    root.querySelector("#library").addEventListener("click", () => openLibrary(false));
    void initialize().catch((error) => {
      status.textContent = error instanceof Error ? error.message : "Close and reopen Memoar to check this tab again.";
    });
  }

  // extension/adapters/dom.ts
  function samePost(url, expected) {
    try {
      const resolved = new URL(url, expected.normalizedUrl);
      if (expected.platform === "instagram" && /^\/[A-Za-z0-9_.]+\/(p|reels?)\/[A-Za-z0-9_-]+\/?$/.test(resolved.pathname)) {
        resolved.pathname = resolved.pathname.replace(/^\/[^/]+/, "");
      }
      const parsed = parsePostUrl(resolved.href);
      return parsed.platform === expected.platform && parsed.postId === expected.postId;
    } catch {
      return false;
    }
  }

  // extension/popover.ts
  var scope = globalThis;
  if (scope.__memoarPopover) scope.__memoarPopover.close();
  else {
    let onKey2 = function(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.close();
      }
    }, onOutside2 = function(event) {
      if (!event.composedPath().includes(host)) state.close();
    };
    onKey = onKey2, onOutside = onOutside2;
    const previousFocus = document.activeElement;
    const pageUrl = location.href;
    let navigationCheck;
    const host = document.createElement("div");
    host.style.cssText = 'all:initial!important;font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;color:#12171c!important;color-scheme:light!important;position:fixed!important;inset:16px 16px auto auto!important;width:min(360px,calc(100vw - 32px))!important;z-index:2147483647!important;';
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = popup_default2 + `
    :host { color-scheme:light; color:#12171c; font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    .panel { position:relative; background:#f6f8fa; border:1px solid #e8edf0; border-radius:24px; box-shadow:0 12px 48px rgb(13 38 54 / 22%); max-height:calc(100dvh - 32px); overflow-y:auto; }
    main { padding-top:42px; }
    .close { position:absolute; top:9px; right:10px; width:30px; height:30px; border:0; border-radius:50%; background:transparent; color:#566570; font-size:22px; cursor:pointer; }
    .close:hover { background:#e8edf0; }
    @media (prefers-reduced-motion:reduce) { * { scroll-behavior:auto; } }
  `;
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Memoar");
    const markup = new DOMParser().parseFromString(popup_default, "text/html").querySelector("main");
    panel.append(document.importNode(markup, true));
    panel.querySelector("header img").src = memoar_icon_default;
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "\xD7";
    close.setAttribute("aria-label", "Close Memoar");
    panel.prepend(close);
    shadow.append(style, panel);
    document.documentElement.append(host);
    const state = { host, close: () => {
      clearInterval(navigationCheck);
      document.removeEventListener("keydown", onKey2, true);
      document.removeEventListener("pointerdown", onOutside2, true);
      host.remove();
      delete scope.__memoarPopover;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    } };
    close.addEventListener("click", state.close);
    document.addEventListener("keydown", onKey2, true);
    document.addEventListener("pointerdown", onOutside2, true);
    scope.__memoarPopover = state;
    const data = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    mountPopup(shadow, pageUrl, { instagram: data(instagram_default), threads: data(threads_default), facebook: data(facebook_default) });
    navigationCheck = setInterval(() => {
      if (location.href === pageUrl) return;
      try {
        if (samePost(location.href, parsePostUrl(pageUrl))) return;
      } catch {
      }
      state.close();
    }, 300);
    close.focus({ preventScroll: true });
  }
  var onKey;
  var onOutside;
})();
