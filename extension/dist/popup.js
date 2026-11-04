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

  // src/lib/inspection/fields.ts
  function missing(reason) {
    return { value: null, status: "unavailable", source: "none", reason, processingEligibility: "unverified" };
  }
  function emptyContentFields() {
    const reason = "No permitted content retrieval API is configured. oEmbed is used only for display, not content extraction or AI ingestion.";
    return {
      postId: missing("No post identifier parsed."),
      authorHandle: missing("The actual author has not been verified through a permitted metadata API."),
      authorUrl: missing("The actual author profile has not been verified."),
      collaboratorHandles: missing("No unambiguous collaboration header was observed."),
      audioLabel: missing("No scoped audio label was observed. An audio label is not an audio file."),
      captionText: missing(reason),
      textContent: missing(reason),
      hashtags: missing(reason),
      mediaType: missing("The URL path does not establish the actual media type or carousel contents."),
      thumbnailUrl: missing(reason),
      imageUrls: missing(reason),
      videoUrl: missing(reason),
      audioUrl: missing(reason),
      publishedAt: missing("Publication time is not available. Inspection time is a different observation."),
      location: missing(reason)
    };
  }

  // src/lib/inspection/readiness.ts
  function evaluateInput(modality, evidence) {
    const base = {
      modality,
      technicallyAccessible: evidence.access === "available",
      processingEligibility: evidence.processingEligibility,
      sourceFields: evidence.sourceFields
    };
    if (evidence.access === "missing") return { ...base, status: "blocked", reason: `No retrieved ${modality} input. A post URL or embedded player is not an AI payload.` };
    if (evidence.processingEligibility === "not_allowed") return { ...base, status: "blocked", reason: "The source does not permit AI processing of this input." };
    if (evidence.formatSupported === false) return { ...base, status: "blocked", reason: "The available input format is not supported by this model." };
    if (evidence.access === "unknown" || evidence.processingEligibility === "unverified" || evidence.formatSupported === null) {
      return { ...base, status: "unknown", reason: evidence.access === "available" && evidence.processingEligibility === "unverified" ? "Technically captured / Permission unverified. Input exists, but permission for AI processing has not been established." : "Access, processing permission, or input format has not been verified." };
    }
    return { ...base, status: "ready", reason: "Input is accessible, its format is supported, and processing is permitted." };
  }
  function buildReadiness(fields, media) {
    const candidates = {
      text: ["captionText", "textContent"],
      image: ["imageUrls"],
      video: ["videoUrl"],
      audio: ["audioUrl"]
    };
    const input = (modality, embeddedAudio = false) => {
      const available = candidates[modality].filter((key) => {
        const field = fields[key];
        return field.status === "available" && (Array.isArray(field.value) ? field.value.length > 0 : typeof field.value === "string" && field.value.trim().length > 0);
      });
      const text = modality === "text" && available.some((key) => typeof fields[key].value === "string" && String(fields[key].value).trim().length > 0);
      const items = media?.items.filter((item) => item.type === modality || embeddedAudio && item.type === "video" && item.verification?.audio === "present") ?? [];
      const verified = items.filter((item) => item.assetAccess === "verified_accessible" && item.verification && item.url && !item.url.startsWith("blob:"));
      const accessible = text || verified.length > 0;
      const sources = items.length ? [.../* @__PURE__ */ new Set([...available, ...items.map((item) => `media.items[${media.items.indexOf(item)}]`)])] : available;
      const evaluated = evaluateInput(modality, {
        access: accessible ? "available" : items.length && items.every((item) => item.assetAccess === "unavailable") ? "missing" : items.length || available.length > 0 || candidates[modality].some((key) => fields[key].status === "unknown") ? "unknown" : "missing",
        processingEligibility: candidates[modality].some((key) => fields[key].processingEligibility === "not_allowed") || embeddedAudio && fields.videoUrl.processingEligibility === "not_allowed" ? "not_allowed" : available.length > 0 && available.every((key) => fields[key].processingEligibility === "allowed") ? "allowed" : "unverified",
        formatSupported: text || modality === "video" && verified.length > 0 ? true : null,
        sourceFields: sources
      });
      if (items.length) evaluated.reason += ` ${verified.length} of ${items.length} observed ${modality} item(s) independently verified. ${embeddedAudio ? "Audio evidence is an embedded MP4 track, not a separate WAV input; speech content and model audio quality are unverified. " : ""}${media?.completeness === "partial" ? "Media capture is incomplete; remaining slides and their types are unknown." : "Slide completeness does not establish model format compatibility or processing permission."}`;
      return evaluated;
    };
    return {
      museSpark: ["text", "image", "video", "audio"].map((modality) => input(modality, modality === "audio")),
      sam31: [input("image"), input("video")].map((item) => ({ ...item, reason: `${item.reason} Segmentation also needs an appropriate target/prompt in a later phase.` })),
      museVoiceTranscribe: [input("audio")]
    };
  }

  // src/lib/capture/protocol.ts
  var MEMOAR_ORIGIN = "http://localhost:3000";
  var CAPTURE_TTL_MS = 5 * 60 * 1e3;
  var MAX_CAPTURE_BYTES = 256 * 1024;
  var MAX_TEXT_CHARS = 32e3;
  var MAX_URL_CHARS = 4096;
  var CAPTURE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function captureBytes(value) {
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
  }

  // src/lib/capture/snapshot.ts
  var MAX_SNAPSHOT_CHARS = 128 * 1024;
  function normalizeSnapshot(input) {
    if (input === void 0) return void 0;
    if (!isRecord(input)) throw new Error("Invalid snapshot.");
    if (input.status === "unavailable") {
      if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.length > 1e3) throw new Error("Invalid snapshot reason.");
      return { status: "unavailable", reason: input.reason };
    }
    if (input.status !== "available" || typeof input.dataUrl !== "string" || input.dataUrl.length > MAX_SNAPSHOT_CHARS || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.dataUrl)) throw new Error("Invalid or oversized JPEG snapshot.");
    const bytes = Uint8Array.from(atob(input.dataUrl.slice("data:image/jpeg;base64,".length)), (char) => char.charCodeAt(0));
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error("Invalid JPEG snapshot.");
    let dimensions;
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset++] !== 255) break;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217) break;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194].includes(marker)) {
        dimensions = [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]];
        break;
      }
      offset += length;
    }
    if (!dimensions || dimensions.some((value) => value < 1 || value > 720) || dimensions[0] !== input.width || dimensions[1] !== input.height) throw new Error("Invalid snapshot dimensions.");
    return { status: "available", dataUrl: input.dataUrl, width: dimensions[0], height: dimensions[1], source: "browser_snapshot", processingEligibility: "unverified" };
  }

  // src/lib/capture/mp4.ts
  var MAX_VIDEO_BYTES = 25 * 1024 * 1024;

  // src/lib/capture/media.ts
  function normalizeMedia(raw, validate) {
    if (raw === void 0) return;
    if (!isRecord(raw) || !["single", "carousel"].includes(String(raw.kind)) || !Array.isArray(raw.items) || raw.items.length > 20 || !["not_requested", "completed", "stopped"].includes(String(raw.navigation))) throw new Error("Invalid media capture.");
    const bounded = (value) => {
      if (typeof value !== "string" || !value || value.length > 1e3) throw new Error("Invalid media reason.");
      return value;
    };
    const number = (value, maximum) => {
      if (value === null) return null;
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) throw new Error("Invalid media dimensions or position.");
      return Number(value);
    };
    const items = raw.items.map((item) => {
      if (!isRecord(item) || !["image", "video"].includes(String(item.type)) || !["reference_only", "verified_accessible", "unavailable"].includes(String(item.assetAccess))) throw new Error("Invalid media item.");
      const url = item.url === null ? null : validate(item.url);
      const result = {
        position: number(item.position, 1e3),
        type: item.type,
        url,
        referenceUrl: item.referenceUrl === null ? null : validate(item.referenceUrl),
        posterUrl: item.posterUrl === null ? null : validate(item.posterUrl),
        width: number(item.width, 5e4),
        height: number(item.height, 5e4),
        processingEligibility: "unverified",
        assetAccess: url ? item.assetAccess === "unavailable" ? "unavailable" : "reference_only" : "unavailable",
        reason: bounded(item.reason)
      };
      const proof = item.verification;
      const videoProof = item.type === "video" && isRecord(proof) && proof.mimeType === "video/mp4" && typeof proof.durationSeconds === "number" && Number.isFinite(proof.durationSeconds) && proof.durationSeconds > 0 && proof.durationSeconds <= 86400 && ["present", "absent"].includes(String(proof.audio)) && typeof proof.sha256 === "string" && /^[a-f0-9]{64}$/.test(proof.sha256);
      if (url && !url.startsWith("blob:") && isRecord(proof) && proof.method === "cors_get" && (videoProof || item.type === "image" && ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(String(proof.mimeType))) && Number.isInteger(proof.byteLength) && Number(proof.byteLength) > 0 && Number(proof.byteLength) <= (item.type === "video" ? MAX_VIDEO_BYTES : 10 * 1024 * 1024) && typeof proof.checkedAt === "string" && Number.isFinite(Date.parse(proof.checkedAt)) && result.width && result.height) {
        result.verification = { method: "cors_get", mimeType: String(proof.mimeType), byteLength: Number(proof.byteLength), checkedAt: new Date(proof.checkedAt).toISOString() };
        if (videoProof) Object.assign(result.verification, { durationSeconds: proof.durationSeconds, audio: proof.audio, sha256: proof.sha256 });
        if (item.assetAccess === "verified_accessible") result.assetAccess = "verified_accessible";
      }
      return result;
    });
    const totalSlides = number(raw.totalSlides, 1e3);
    const positions = items.map((item) => item.position);
    const complete = raw.completeness === "complete" && totalSlides !== null && items.length === totalSlides && new Set(positions).size === totalSlides && positions.every((position) => position !== null && position <= totalSlides) && items.every((item) => item.url);
    const types = new Set(items.map((item) => item.type));
    return {
      kind: raw.kind,
      totalSlides,
      items,
      ...raw.discovery === "embedded_json" ? { discovery: "embedded_json" } : {},
      navigation: raw.navigation,
      completeness: complete ? "complete" : "partial",
      reason: bounded(raw.reason),
      composition: types.size > 1 ? "mixed" : complete && types.has("image") ? "image_only" : complete && types.has("video") ? "video_only" : "unknown"
    };
  }
  function applyMediaFields(fields, media) {
    const set = (key, value, reason) => {
      Object.assign(fields[key], {
        value,
        status: value === null ? "unavailable" : "available",
        source: value === null ? "none" : "browser_media_reference",
        reason,
        processingEligibility: "unverified",
        assetAccess: value === null ? "unavailable" : "reference_only"
      });
    };
    const images = [...new Set(media.items.filter((item) => item.type === "image" && item.url).map((item) => item.url))];
    const videos = [...new Set(media.items.filter((item) => item.type === "video" && item.url).map((item) => item.url))];
    const posters = [...new Set(media.items.map((item) => item.posterUrl).filter((value) => Boolean(value)))];
    set("imageUrls", images.length ? images : null, "Image references from matched post media; see media.items for order and accessibility.");
    set("videoUrl", videos.length === 1 ? videos[0] : null, videos.length > 1 ? "Multiple video slides; use media.items for ordered references." : "Matched video reference; see media.items for MP4, duration and audio verification. Blob URLs are not reusable files.");
    set(
      "thumbnailUrl",
      media.items[0]?.type === "image" ? media.items[0].url : media.items[0]?.posterUrl ?? null,
      posters.length ? "Observed video poster reference; not a snapshot or a verified image file." : images.length ? "First observed image slide." : "The visible video player exposed no supported poster URL."
    );
    if (media.kind === "carousel" || media.items.length === 1) Object.assign(fields.mediaType, { value: media.kind === "carousel" ? "carousel" : media.items[0].type, status: "available", source: "browser_dom", reason: media.reason });
    for (const key of ["imageUrls", "videoUrl", "thumbnailUrl"]) {
      const urls = Array.isArray(fields[key].value) ? fields[key].value : fields[key].value ? [fields[key].value] : [];
      const matching = media.items.filter((item) => item.url && urls.includes(item.url));
      if (urls.length && matching.length && urls.every((url) => matching.some((item) => item.url === url && item.assetAccess === "verified_accessible"))) fields[key].assetAccess = "verified_accessible";
      else if (urls.length && matching.length && matching.every((item) => item.assetAccess === "unavailable")) fields[key].assetAccess = "unavailable";
    }
  }

  // src/lib/capture/normalize.ts
  var mediaKeys = /* @__PURE__ */ new Set(["thumbnailUrl", "imageUrls", "videoUrl", "audioUrl"]);
  var nullableStatuses = /* @__PURE__ */ new Set(["unavailable", "unknown", "restricted", "unsupported"]);
  var secretKey = /token|password|authorization|cookie|api[_-]?key|secret/i;
  function boundedString(value, maximum, label) {
    if (typeof value !== "string" || value.length > maximum) throw new Error(`${label} is invalid or exceeds its size limit.`);
    return value;
  }
  function validateMediaReference(value, platform) {
    const input = boundedString(value, MAX_URL_CHARS, "Media reference");
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error("Invalid media reference URL.");
    }
    if (url.protocol === "blob:") {
      let origin;
      try {
        origin = new URL(input.slice(5));
      } catch {
        throw new Error("Invalid blob reference.");
      }
      const permitted = platform === "threads" ? ["threads.com", "threads.net"] : [`${platform}.com`];
      if (origin.protocol !== "https:" || !permitted.some((host2) => origin.hostname === host2 || origin.hostname === `www.${host2}`)) throw new Error("Blob reference belongs to another origin.");
      return input;
    }
    const host = url.hostname;
    const cdn = ["cdninstagram.com", "fbcdn.net"];
    if (url.protocol !== "https:" || url.username || url.password || url.port || !cdn.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      throw new Error("Media reference is not an allowlisted Meta CDN URL.");
    }
    if ([...url.searchParams.keys()].some((key) => secretKey.test(key))) throw new Error("Credential-like media URL parameters are not accepted.");
    return input;
  }
  function deriveHashtags(text) {
    const pattern = new RegExp("#[\\p{L}\\p{N}_]+", "gu");
    return [...new Set(text.match(pattern) ?? [])];
  }
  function normalizeCapture(raw) {
    if (captureBytes(raw) > MAX_CAPTURE_BYTES) throw new Error("Capture exceeds the 256 KiB limit.");
    if (!isRecord(raw) || raw.version !== 1 || !isRecord(raw.inspection)) throw new Error("Paste a version 1 Memoar extension capture.");
    const input = raw.inspection;
    const parsed = parsePostUrl(input.normalizedUrl);
    if (input.platform !== parsed.platform || !isRecord(input.fields)) throw new Error("Capture platform does not match its post URL.");
    if (input.inspectionMethod !== "extension") throw new Error("This is not an extension capture.");
    if (!isRecord(input.fields.postId) || input.fields.postId.value !== parsed.postId) throw new Error("Captured post ID does not match its URL.");
    const inspectedAt = boundedString(input.inspectedAt, 40, "Capture time");
    if (!Number.isFinite(Date.parse(inspectedAt))) throw new Error("Capture time is invalid.");
    const fields = emptyContentFields();
    for (const key of Object.keys(fields)) {
      const candidate = input.fields[key];
      if (candidate === void 0 && (key === "collaboratorHandles" || key === "audioLabel")) continue;
      if (!isRecord(candidate)) throw new Error(`Capture field ${key} is missing.`);
      const reason = candidate.reason == null ? null : boundedString(candidate.reason, 1e3, "Field reason");
      let field;
      if (candidate.value === null) {
        if (typeof candidate.status !== "string" || !nullableStatuses.has(candidate.status)) throw new Error(`Invalid null status for ${key}.`);
        field = { value: null, status: candidate.status, source: "none", reason: reason || "No unambiguous value was observed in the active post.", processingEligibility: "unverified" };
      } else {
        const expectedSource = key === "postId" ? "url" : mediaKeys.has(key) ? "browser_media_reference" : "browser_dom";
        if (candidate.status !== "available" || candidate.source !== expectedSource) throw new Error(`Invalid source or status for ${key}.`);
        let value = candidate.value;
        if (key === "imageUrls") {
          if (!Array.isArray(value) || value.length > 20) throw new Error("Capture supports at most 20 image references.");
          value = value.map((item) => validateMediaReference(item, parsed.platform));
        } else if (key === "collaboratorHandles") {
          if (!Array.isArray(value) || value.length < 2 || value.length > 10 || !value.every((item) => typeof item === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(item))) throw new Error("Invalid collaborator handles.");
        } else if (key === "hashtags") {
          if (!Array.isArray(value) || value.length > MAX_TEXT_CHARS || !value.every((item) => typeof item === "string" && item.length <= MAX_TEXT_CHARS)) throw new Error("Invalid hashtags.");
        } else if (mediaKeys.has(key)) value = validateMediaReference(value, parsed.platform);
        else {
          const text = boundedString(value, key.endsWith("Url") ? MAX_URL_CHARS : MAX_TEXT_CHARS, key);
          if (!text.trim()) throw new Error(`${key} cannot be an empty available value.`);
          value = text;
        }
        if (key === "mediaType" && !["image", "video", "carousel", "text"].includes(value)) throw new Error("Invalid observed media type.");
        if (key === "authorUrl") {
          const author = new URL(value);
          const post = new URL(parsed.normalizedUrl);
          if (author.origin !== post.origin || author.username || author.password || author.search || author.hash || !/^\/(?:@)?[A-Za-z0-9_.-]+\/?$/.test(author.pathname)) throw new Error("Invalid author profile URL.");
        }
        field = { value, status: "available", source: expectedSource, reason, processingEligibility: "unverified" };
      }
      if (mediaKeys.has(key)) field.assetAccess = field.value === null ? "unavailable" : "reference_only";
      Object.assign(fields, { [key]: field });
    }
    fields.postId = { value: parsed.postId, status: "available", source: "url", reason: "Parsed from the active post URL, not verified by an API.", processingEligibility: "unverified" };
    const capturedText = [fields.captionText.value, fields.textContent.value].filter((value) => value !== null).join("\n");
    fields.hashtags = capturedText ? { value: deriveHashtags(capturedText), status: "available", source: "browser_dom", reason: "Derived only from captured post text.", processingEligibility: "unverified" } : { value: null, status: "unavailable", source: "none", reason: "No post text was captured to derive hashtags from.", processingEligibility: "unverified" };
    const warnings = input.warnings == null ? [] : input.warnings;
    if (!Array.isArray(warnings) || warnings.length > 12) throw new Error("Invalid capture warnings.");
    const baseWarning = "Media references alone do not establish accessible files. Browser access does not establish permission for AI processing.";
    const cleanWarnings = [.../* @__PURE__ */ new Set([...warnings.map((value) => boundedString(value, 1e3, "Capture warning")), baseWarning])];
    if (cleanWarnings.length > 12) throw new Error("Capture contains too many warnings.");
    const media = normalizeMedia(input.media, (value) => validateMediaReference(value, parsed.platform));
    if (media) applyMediaFields(fields, media);
    const inspection = {
      ...media ? { media } : {},
      inspectionMethod: "extension",
      platform: parsed.platform,
      inputUrl: parsed.normalizedUrl,
      normalizedUrl: parsed.normalizedUrl,
      inspectedAt: new Date(inspectedAt).toISOString(),
      status: "partial",
      fields,
      preview: { kind: "source_link", status: "unavailable", renderStatus: "unverified", reason: "Official preview has not been requested for this capture." },
      aiReadiness: buildReadiness(fields, media),
      attempts: [
        { method: "url_parser", outcome: "success", reason: "Validated the captured platform and post identity." },
        { method: "browser_dom_capture", outcome: "partial", reason: "One-time observations from the active post. Missing fields and text completeness remain explicit." },
        { method: "ai_payload_evaluation", outcome: "success", reason: "Evaluated locally. No AI request was made; processing permission remains unverified." }
      ],
      warnings: cleanWarnings
    };
    const snapshot = normalizeSnapshot(raw.snapshot);
    const envelope = { version: 1, inspection, ...snapshot ? { snapshot } : {} };
    if (captureBytes(envelope) > MAX_CAPTURE_BYTES) throw new Error("Normalized capture exceeds the 256 KiB limit.");
    return envelope;
  }

  // extension/popup.ts
  var captureButton = document.querySelector("#capture");
  var openButton = document.querySelector("#open");
  var copyButton = document.querySelector("#copy");
  var status = document.querySelector("#status");
  var current = null;
  function setResult(result) {
    current = result;
    openButton.disabled = !result;
    copyButton.disabled = !result;
  }
  async function initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const parsed = parsePostUrl(tab?.url);
      document.querySelector("#platform").textContent = `${parsed.platform.charAt(0).toUpperCase()}${parsed.platform.slice(1)} post`;
      document.querySelector("#page-url").textContent = parsed.normalizedUrl;
      captureButton.disabled = false;
    } catch {
      document.querySelector("#platform").textContent = "No supported post";
      document.querySelector("#page-url").textContent = "Open a specific Instagram, Threads, or Facebook post permalink.";
    }
    const previous = await chrome.runtime.sendMessage({ type: "LAST_CAPTURE" });
    if (previous?.ok && previous.result) {
      setResult({ ...previous.result, payload: normalizeCapture(previous.result.payload) });
      status.textContent = "A previous capture is available briefly for Open in Memoar or manual JSON copy.";
    }
  }
  captureButton.addEventListener("click", () => {
    captureButton.disabled = true;
    setResult(null);
    document.querySelector("#manual-copy").hidden = true;
    const allSlides = document.querySelector("#all-slides").checked;
    status.textContent = allSlides ? "Capturing carousel slides and checking permitted image resources\u2026" : "Reading the visible active post and checking permitted image resources\u2026";
    void chrome.runtime.sendMessage({ type: "START_CAPTURE", allSlides }).then((response) => {
      if (!response?.ok) throw new Error(response?.error ?? "Capture did not return a result.");
      const payload = normalizeCapture(response.result.payload);
      setResult({ ...response.result, payload });
      const count = Object.entries(payload.inspection.fields).filter(([key, field]) => key !== "postId" && field.status === "available").length;
      status.textContent = `Partial capture: ${count} content fields available. ${payload.snapshot?.status === "available" ? "Captured snapshot included." : "Snapshot unavailable."} Review missing values and permission limits in Memoar.`;
    }).catch((error) => {
      status.textContent = error instanceof Error ? error.message : "Capture failed.";
    }).finally(() => {
      captureButton.disabled = false;
    });
  });
  openButton.addEventListener("click", () => {
    if (!current || !CAPTURE_ID.test(current.captureId) || current.expiresAt <= Date.now()) {
      status.textContent = "Capture expired. Capture the post again.";
      setResult(null);
      return;
    }
    const url = new URL(MEMOAR_ORIGIN);
    url.searchParams.set("captureId", current.captureId);
    url.searchParams.set("extensionId", chrome.runtime.id);
    void chrome.tabs.create({ url: url.href }).catch(() => {
      status.textContent = "Could not open Memoar. Copy captured JSON instead.";
    });
  });
  copyButton.addEventListener("click", () => {
    if (!current || current.expiresAt <= Date.now()) {
      setResult(null);
      status.textContent = "Capture expired. Capture again.";
      return;
    }
    const json = JSON.stringify(current.payload, null, 2);
    void Promise.resolve().then(() => {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable.");
      return navigator.clipboard.writeText(json);
    }).then(() => {
      status.textContent = "Captured JSON copied. In Memoar, choose Paste captured JSON.";
    }).catch(() => {
      const textarea = document.querySelector("#manual-copy");
      textarea.value = json;
      textarea.hidden = false;
      textarea.focus();
      textarea.select();
      status.textContent = "Clipboard unavailable. Copy the selected JSON manually.";
    });
  });
  void initialize().catch(() => {
    status.textContent = "Could not initialize the extension. Close and reopen this popup.";
  });
})();
