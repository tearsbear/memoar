"use strict";
(() => {
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

  // src/lib/capture/protocol.ts
  var MEMOAR_ORIGIN = true ? "https://memoar-theta.vercel.app" : "https://memoar-theta.vercel.app";
  var CAPTURE_TTL_MS = 5 * 60 * 1e3;
  var MAX_CAPTURE_BYTES = 256 * 1024;

  // extension/popup.ts
  var save = document.querySelector("#capture");
  var open = document.querySelector("#open");
  var status = document.querySelector("#status");
  var savedId = null;
  function saved(id, duplicate) {
    savedId = id;
    open.hidden = false;
    save.hidden = true;
    status.textContent = duplicate ? "Already in Memoar." : "Saved to Memoar. Open your library to explore it.";
  }
  async function initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const parsed = parsePostUrl(tab?.url);
      document.querySelector("#platform").textContent = parsed.platform.charAt(0).toUpperCase() + parsed.platform.slice(1);
      const icon = document.querySelector("#platform-icon");
      icon.src = `platforms/${parsed.platform}.svg`;
      icon.hidden = false;
      const url = document.querySelector("#page-url");
      url.textContent = parsed.normalizedUrl;
      url.title = parsed.normalizedUrl;
      status.textContent = parsed.platform === "facebook" ? "Facebook capture may be partial. Only available post content is saved." : "";
      save.disabled = false;
      const response = await chrome.runtime.sendMessage({ type: "FIND_SAVED", url: parsed.normalizedUrl });
      if (response?.ok && response.result?.post) saved(response.result.post.id, true);
    } catch {
      document.querySelector("#platform").textContent = "No supported post";
      document.querySelector("#platform-icon").hidden = true;
      status.textContent = "Open a supported Instagram, Threads, or Facebook post to save it.";
    }
  }
  save.addEventListener("click", () => {
    save.disabled = true;
    save.textContent = "Saving your post\u2026";
    status.textContent = "Keep the post open while Memoar captures its available content. Carousels may move through slides.";
    void chrome.runtime.sendMessage({ type: "SAVE_POST" }).then((response) => {
      if (!response?.ok || !response.result?.postId) throw new Error(response?.error ?? "Couldn\u2019t save this post. Try again.");
      saved(response.result.postId, response.result.duplicate === true);
    }).catch((error) => {
      status.textContent = error instanceof Error ? error.message : "Couldn\u2019t save this post. Try again.";
      save.textContent = "Try saving again";
    }).finally(() => {
      save.disabled = false;
    });
  });
  function openLibrary(detail) {
    const url = new URL(detail && savedId ? `/app/saved/${encodeURIComponent(savedId)}` : "/setup", MEMOAR_ORIGIN);
    url.searchParams.set("extensionId", chrome.runtime.id);
    void chrome.tabs.create({ url: url.href }).catch(() => {
      status.textContent = "Couldn\u2019t open Memoar. Try again.";
    });
  }
  open.addEventListener("click", () => openLibrary(true));
  document.querySelector("#library").addEventListener("click", () => openLibrary(false));
  void initialize().catch(() => {
    status.textContent = "Close and reopen Memoar to check this tab again.";
  });
})();
