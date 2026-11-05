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
    for (const key2 of url.searchParams.keys()) {
      if (secret.test(key2)) throw new UrlValidationError("invalid_url", "Remove credentials or secret parameters from the URL.");
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
    for (const key2 of [...url.searchParams.keys()]) {
      if (tracking.test(key2)) url.searchParams.delete(key2);
    }
    url.hash = "";
    url.hostname = platform === "threads" ? "www.threads.com" : `www.${platform}.com`;
    url.pathname = path.endsWith("/") ? path : `${path}/`;
    url.searchParams.sort();
    return { platform, inputUrl, normalizedUrl: url.toString(), postId, route, previewSupported };
  }

  // src/lib/capture/protocol.ts
  var MEMOAR_ORIGIN = true ? "https://memoar-theta.vercel.app" : "https://memoar-theta.vercel.app";
  var LOCAL_MEMOAR_ORIGIN = "http://localhost:3000";
  function isMemoarOrigin(origin) {
    return origin === "https://memoar-theta.vercel.app" || origin === LOCAL_MEMOAR_ORIGIN;
  }
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
  function isMemoarSender(sender) {
    if (sender.id || !sender.url || sender.frameId !== 0) return false;
    try {
      const origin = new URL(sender.url).origin;
      return isMemoarOrigin(origin) && (!sender.origin || sender.origin === origin);
    } catch {
      return false;
    }
  }
  function isTakeRequest(value) {
    return isRecord(value) && Object.keys(value).length === 2 && value.type === "TAKE_CAPTURE" && typeof value.captureId === "string" && CAPTURE_ID.test(value.captureId);
  }
  function isMediaTransferRequest(value) {
    if (!isRecord(value) || typeof value.captureId !== "string" || !CAPTURE_ID.test(value.captureId)) return false;
    if (value.type === "RELEASE_MEDIA") return Object.keys(value).length === 2;
    return value.type === "TAKE_MEDIA_CHUNK" && Object.keys(value).length === 4 && Number.isInteger(value.itemIndex) && Number(value.itemIndex) >= 0 && Number(value.itemIndex) < 20 && Number.isInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) < 50 * 1024 * 1024;
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
      const available = candidates[modality].filter((key2) => {
        const field = fields[key2];
        return field.status === "available" && (Array.isArray(field.value) ? field.value.length > 0 : typeof field.value === "string" && field.value.trim().length > 0);
      });
      const text = modality === "text" && available.some((key2) => typeof fields[key2].value === "string" && String(fields[key2].value).trim().length > 0);
      const items = media?.items.filter((item) => item.type === modality || embeddedAudio && item.type === "video" && item.verification?.audio === "present") ?? [];
      const verified = items.filter((item) => item.assetAccess === "verified_accessible" && item.verification && item.url && !item.url.startsWith("blob:"));
      const accessible = text || verified.length > 0;
      const sources = items.length ? [.../* @__PURE__ */ new Set([...available, ...items.map((item) => `media.items[${media.items.indexOf(item)}]`)])] : available;
      const evaluated = evaluateInput(modality, {
        access: accessible ? "available" : items.length && items.every((item) => item.assetAccess === "unavailable") ? "missing" : items.length || available.length > 0 || candidates[modality].some((key2) => fields[key2].status === "unknown") ? "unknown" : "missing",
        processingEligibility: candidates[modality].some((key2) => fields[key2].processingEligibility === "not_allowed") || embeddedAudio && fields.videoUrl.processingEligibility === "not_allowed" ? "not_allowed" : available.length > 0 && available.every((key2) => fields[key2].processingEligibility === "allowed") ? "allowed" : "unverified",
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

  // src/lib/capture/snapshot.ts
  var MAX_SNAPSHOT_CHARS = 128 * 1024;
  function validateRegion(input) {
    if (!isRecord(input)) throw new Error("No visible media region was identified.");
    const result = {};
    for (const key2 of ["x", "y", "width", "height", "viewportWidth", "viewportHeight", "scrollX", "scrollY"]) {
      const value = input[key2];
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error("Invalid snapshot region.");
      result[key2] = value;
    }
    if (result.x < 0 || result.y < 0 || result.width < 16 || result.height < 16 || result.viewportWidth <= 0 || result.viewportHeight <= 0 || result.x + result.width > result.viewportWidth + 1 || result.y + result.height > result.viewportHeight + 1) throw new Error("Snapshot region is outside the visible viewport.");
    return result;
  }
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
    const set = (key2, value, reason) => {
      Object.assign(fields[key2], {
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
    for (const key2 of ["imageUrls", "videoUrl", "thumbnailUrl"]) {
      const urls = Array.isArray(fields[key2].value) ? fields[key2].value : fields[key2].value ? [fields[key2].value] : [];
      const matching = media.items.filter((item) => item.url && urls.includes(item.url));
      if (urls.length && matching.length && urls.every((url) => matching.some((item) => item.url === url && item.assetAccess === "verified_accessible"))) fields[key2].assetAccess = "verified_accessible";
      else if (urls.length && matching.length && matching.every((item) => item.assetAccess === "unavailable")) fields[key2].assetAccess = "unavailable";
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
    if ([...url.searchParams.keys()].some((key2) => secretKey.test(key2))) throw new Error("Credential-like media URL parameters are not accepted.");
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
    for (const key2 of Object.keys(fields)) {
      const candidate = input.fields[key2];
      if (candidate === void 0 && (key2 === "collaboratorHandles" || key2 === "audioLabel")) continue;
      if (!isRecord(candidate)) throw new Error(`Capture field ${key2} is missing.`);
      const reason = candidate.reason == null ? null : boundedString(candidate.reason, 1e3, "Field reason");
      let field;
      if (candidate.value === null) {
        if (typeof candidate.status !== "string" || !nullableStatuses.has(candidate.status)) throw new Error(`Invalid null status for ${key2}.`);
        field = { value: null, status: candidate.status, source: "none", reason: reason || "No unambiguous value was observed in the active post.", processingEligibility: "unverified" };
      } else {
        const expectedSource = key2 === "postId" ? "url" : mediaKeys.has(key2) ? "browser_media_reference" : "browser_dom";
        if (candidate.status !== "available" || candidate.source !== expectedSource) throw new Error(`Invalid source or status for ${key2}.`);
        let value = candidate.value;
        if (key2 === "imageUrls") {
          if (!Array.isArray(value) || value.length > 20) throw new Error("Capture supports at most 20 image references.");
          value = value.map((item) => validateMediaReference(item, parsed.platform));
        } else if (key2 === "collaboratorHandles") {
          if (!Array.isArray(value) || value.length < 2 || value.length > 10 || !value.every((item) => typeof item === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(item))) throw new Error("Invalid collaborator handles.");
        } else if (key2 === "hashtags") {
          if (!Array.isArray(value) || value.length > MAX_TEXT_CHARS || !value.every((item) => typeof item === "string" && item.length <= MAX_TEXT_CHARS)) throw new Error("Invalid hashtags.");
        } else if (mediaKeys.has(key2)) value = validateMediaReference(value, parsed.platform);
        else {
          const text = boundedString(value, key2.endsWith("Url") ? MAX_URL_CHARS : MAX_TEXT_CHARS, key2);
          if (!text.trim()) throw new Error(`${key2} cannot be an empty available value.`);
          value = text;
        }
        if (key2 === "mediaType" && !["image", "video", "carousel", "text"].includes(value)) throw new Error("Invalid observed media type.");
        if (key2 === "authorUrl") {
          const author = new URL(value);
          const post = new URL(parsed.normalizedUrl);
          if (author.origin !== post.origin || author.username || author.password || author.search || author.hash || !/^\/(?:@)?[A-Za-z0-9_.-]+\/?$/.test(author.pathname)) throw new Error("Invalid author profile URL.");
        }
        field = { value, status: "available", source: expectedSource, reason, processingEligibility: "unverified" };
      }
      if (mediaKeys.has(key2)) field.assetAccess = field.value === null ? "unavailable" : "reference_only";
      Object.assign(fields, { [key2]: field });
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

  // extension/session.ts
  function createCaptureSession(storage, now = Date.now, uuid = () => crypto.randomUUID()) {
    let queue = Promise.resolve();
    const serialized = (action) => {
      const next = queue.then(action, action);
      queue = next.catch(() => {
      });
      return next;
    };
    async function current2() {
      const value = await storage.get();
      if (value && value.expiresAt <= now()) {
        await storage.clear();
        return null;
      }
      return value;
    }
    return {
      put: (input) => serialized(async () => {
        const value = { id: uuid(), expiresAt: now() + CAPTURE_TTL_MS, payload: normalizeCapture(input) };
        await storage.set(value);
        return value;
      }),
      peek: () => serialized(current2),
      take: (id) => serialized(async () => {
        const value = await current2();
        if (!value || value.id !== id) throw new Error("Capture is missing, expired, or already imported. Capture the post again, or use copied JSON.");
        await storage.clear();
        return normalizeCapture(value.payload);
      })
    };
  }

  // extension/snapshot.ts
  function pixelCrop(region, bitmapWidth, bitmapHeight) {
    validateRegion(region);
    const sx = bitmapWidth / region.viewportWidth, sy = bitmapHeight / region.viewportHeight;
    if (sx < 0.5 || sy < 0.5 || sx > 5 || sy > 5 || Math.abs(sx - sy) > 0.05) throw new Error("Viewport dimensions changed during snapshot.");
    const width = Math.floor(region.width * sx), height = Math.floor(region.height * sy);
    const scale = Math.min(1, 720 / Math.max(width, height));
    return { x: Math.floor(region.x * sx), y: Math.floor(region.y * sy), width, height, outputWidth: Math.max(1, Math.round(width * scale)), outputHeight: Math.max(1, Math.round(height * scale)) };
  }
  async function takeSnapshot(tabId, windowId, url, candidate) {
    if (!candidate) return { status: "unavailable", reason: "No single unobscured visible media region was identified. Captured fields are retained." };
    try {
      const region = validateRegion(candidate.region);
      if (!Number.isInteger(candidate.mediaIndex) || candidate.mediaIndex < 0 || candidate.mediaIndex > 1e4 || typeof candidate.mediaSource !== "string" || candidate.mediaSource.length > 4096) throw new Error("Invalid media region.");
      const guard = async () => {
        const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (active?.id !== tabId || active.windowId !== windowId || active.url !== url) throw new Error("Source tab changed.");
        const [probe] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [0] },
          world: "ISOLATED",
          args: [candidate, url],
          func: (target, expectedUrl) => {
            const panel = globalThis.__memoarPopover?.host.getBoundingClientRect();
            const region2 = target.region;
            if (panel && panel.left < region2.x + region2.width && panel.right > region2.x && panel.top < region2.y + region2.height && panel.bottom > region2.y) return false;
            const node = document.querySelectorAll("img, video")[target.mediaIndex];
            if (!node || location.href !== expectedUrl || (node.currentSrc || node.getAttribute("src") || "") !== target.mediaSource) return false;
            const r = node.getBoundingClientRect(), b = target.region;
            const x = Math.max(0, r.left), y = Math.max(0, r.top);
            if ([
              x - b.x,
              y - b.y,
              Math.min(innerWidth, r.right) - x - b.width,
              Math.min(innerHeight, r.bottom) - y - b.height,
              innerWidth - b.viewportWidth,
              innerHeight - b.viewportHeight,
              scrollX - b.scrollX,
              scrollY - b.scrollY
            ].some((delta) => Math.abs(delta) > 1)) return false;
            let frame = node.parentElement;
            for (let next = frame?.parentElement, depth = 0; next && depth < 8; next = next.parentElement, depth++) {
              const bounds = next.getBoundingClientRect();
              if ([bounds.left - r.left, bounds.top - r.top, bounds.width - r.width, bounds.height - r.height].some((delta) => Math.abs(delta) > 2)) break;
              frame = next;
            }
            return [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]].every(([px, py]) => frame?.contains(document.elementsFromPoint(x + b.width * px, y + b.height * py)[0]));
          }
        });
        if (probe?.result !== true) throw new Error("Media moved, changed, or became obscured.");
      };
      await guard();
      const screenshot = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
      await guard();
      const encoded = screenshot.split(",")[1];
      if (!screenshot.startsWith("data:image/png;base64,") || encoded.length > 32 * 1024 * 1024) throw new Error("Unsupported screenshot.");
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      try {
        const crop = pixelCrop(region, bitmap.width, bitmap.height);
        const canvas = new OffscreenCanvas(crop.outputWidth, crop.outputHeight);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Snapshot encoder unavailable.");
        context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.outputWidth, crop.outputHeight);
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.65 });
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (const byte of jpeg) binary += String.fromCharCode(byte);
        return normalizeSnapshot({ status: "available", dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, width: crop.outputWidth, height: crop.outputHeight });
      } finally {
        bitmap.close();
      }
    } catch {
      return { status: "unavailable", reason: "Snapshot could not be captured safely, encoded, or kept within its size limit. Captured fields are retained. Keep the media visible and capture again." };
    }
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

  // src/lib/capture/media-cache.ts
  var MAX_HANDOFF_MEDIA_BYTES = 50 * 1024 * 1024;
  var MEDIA_CHUNK_BYTES = 512 * 1024;
  function parseCapturedAssetInfo(value, media) {
    if (value === void 0) return [];
    if (!Array.isArray(value) || value.length > 20) throw new Error("Invalid captured media manifest.");
    const seen = /* @__PURE__ */ new Set();
    let total = 0;
    return value.map((entry) => {
      if (!isRecord(entry) || !Number.isInteger(entry.itemIndex)) throw new Error("Invalid captured media index.");
      const itemIndex = Number(entry.itemIndex), item = media?.items[itemIndex];
      if (itemIndex < 0 || !item || seen.has(itemIndex) || item.assetAccess !== "verified_accessible" || !item.verification || entry.mimeType !== item.verification.mimeType || entry.byteLength !== item.verification.byteLength) throw new Error("Captured bytes do not match media verification.");
      seen.add(itemIndex);
      total += item.verification.byteLength;
      if (total > MAX_HANDOFF_MEDIA_BYTES) throw new Error("Captured media exceeds the 50 MiB handoff limit.");
      return { itemIndex, mimeType: item.verification.mimeType, byteLength: item.verification.byteLength };
    });
  }

  // extension/media-transfer.ts
  var key = "mediaTransfer";
  async function rememberMediaTransfer(captureId, payload, tabId, url, nonce, expiresAt, rawAssets) {
    const assets = parseCapturedAssetInfo(rawAssets, payload.inspection.media);
    await chrome.storage.session.set({ [key]: { captureId, tabId, url, nonce, expiresAt, assets, claimed: false } });
  }
  async function current(captureId) {
    const value = (await chrome.storage.session.get(key))[key];
    if (!value || value.captureId !== captureId) return null;
    if (value.expiresAt <= Date.now()) {
      await chrome.storage.session.remove(key);
      return null;
    }
    return value;
  }
  async function claimMediaTransfer(captureId) {
    const value = await current(captureId);
    if (!value) return;
    await chrome.storage.session.set({ [key]: { ...value, claimed: true } });
    return value.assets;
  }
  async function transferMedia(request) {
    const value = await current(request.captureId);
    if (!value || !value.claimed) throw new Error("Captured media expired or was already imported. Capture the post again.");
    if (request.type === "RELEASE_MEDIA") {
      await chrome.storage.session.remove(key);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: value.tabId, frameIds: [0] },
          world: "ISOLATED",
          func: (nonce) => {
            const scope = globalThis;
            if (scope.__memoarCapturedMedia?.nonce === nonce) {
              scope.__memoarCapturedMedia.assets.length = 0;
              delete scope.__memoarCapturedMedia;
            }
          },
          args: [value.nonce]
        });
      } catch {
      }
      return {};
    }
    const asset = value.assets.find((item) => item.itemIndex === request.itemIndex);
    if (!asset || request.offset % MEDIA_CHUNK_BYTES || request.offset >= asset.byteLength) throw new Error("Invalid captured media chunk request.");
    const tab = await chrome.tabs.get(value.tabId);
    if (!tab.url || !samePost(tab.url, parsePostUrl(value.url))) throw new Error("The source post changed before its media was imported. Capture again.");
    const result = await chrome.scripting.executeScript({
      target: { tabId: value.tabId, frameIds: [0] },
      world: "ISOLATED",
      func: (nonce, itemIndex, offset, length, expectedUrl) => {
        const scope = globalThis;
        const cache = scope.__memoarCapturedMedia;
        if (!cache || cache.nonce !== nonce || cache.expiresAt <= Date.now() || document.location.href !== expectedUrl) throw new Error("Captured media is no longer available. Capture again.");
        const bytes = cache.assets.find((item) => item.itemIndex === itemIndex)?.bytes;
        if (!bytes || offset >= bytes.length) throw new Error("Captured media bytes are missing. Capture again.");
        const chunk = bytes.subarray(offset, offset + length);
        let binary = "";
        for (let i = 0; i < chunk.length; i += 16384) binary += String.fromCharCode(...chunk.subarray(i, i + 16384));
        return btoa(binary);
      },
      args: [value.nonce, request.itemIndex, request.offset, MEDIA_CHUNK_BYTES, tab.url]
    });
    const base64 = result[0]?.result;
    if (typeof base64 !== "string") throw new Error("Captured media transfer failed. Capture the post again.");
    return { base64 };
  }

  // src/lib/library/store.ts
  function libraryStore(name) {
    let opening;
    function open() {
      if (!opening) opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("posts")) request.result.createObjectStore("posts", { keyPath: "id" });
          if (!request.result.objectStoreNames.contains("assets")) request.result.createObjectStore("assets", { keyPath: "key" });
          const assets = request.transaction.objectStore("assets");
          if (!assets.indexNames.contains("postId")) assets.createIndex("postId", "postId");
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            opening = void 0;
          };
          resolve(request.result);
        };
        request.onerror = () => {
          opening = void 0;
          reject(new Error("Local storage could not be opened. Check browser storage permissions."));
        };
        request.onblocked = () => {
          opening = void 0;
          reject(new Error("Close other Memoar tabs and retry."));
        };
      });
      return opening;
    }
    async function read(store, key2, index) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, "readonly");
        const request = index ? tx.objectStore(store).index(index).getAll(key2) : key2 === void 0 ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key2);
        tx.oncomplete = () => resolve(request.result);
        tx.onabort = tx.onerror = () => reject(new Error("Could not read the local library."));
      });
    }
    async function write(action) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(["posts", "assets"], "readwrite");
        action(tx.objectStore("posts"), tx.objectStore("assets"));
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error("Could not save changes. Browser storage may be full."));
      });
    }
    return {
      list: () => read("posts"),
      get: (id) => read("posts", id),
      assets: async (id) => (await read("assets", id, "postId")).filter((asset) => !asset.temporaryUntil || asset.temporaryUntil > Date.now()),
      put: (post, assets) => write((posts, store) => {
        posts.put(post);
        if (assets) for (const asset of assets) store.put({ ...asset, key: `${post.id}:${asset.itemIndex}`, postId: post.id });
      }),
      update: async (id, update) => write((posts) => {
        const request = posts.get(id);
        request.onsuccess = () => {
          if (request.result) posts.put(update(request.result));
        };
      }),
      cacheAsset: (id, asset) => write((posts, assets) => {
        const request = posts.get(id);
        request.onsuccess = () => {
          if (request.result) assets.put({ ...asset, key: `${id}:${asset.itemIndex}`, postId: id });
        };
      }),
      remove: (id) => write((posts, assets) => {
        posts.delete(id);
        const request = assets.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (cursor.value.postId === id) cursor.delete();
            cursor.continue();
          }
        };
      }),
      clear: () => write((posts, assets) => {
        posts.clear();
        assets.clear();
      }),
      reconcile: (records) => write((posts, assets) => {
        const ids = new Set(records.map((post) => post.id));
        const old = posts.openCursor();
        old.onsuccess = () => {
          const cursor = old.result;
          if (cursor) {
            if (!ids.has(String(cursor.key))) cursor.delete();
            cursor.continue();
          }
        };
        const media = assets.openCursor();
        media.onsuccess = () => {
          const cursor = media.result;
          if (cursor) {
            if (!ids.has(cursor.value.postId)) cursor.delete();
            cursor.continue();
          }
        };
        for (const post of records) posts.put(post);
      }),
      purgeTemporary: () => write((_posts, assets) => {
        const request = assets.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            if (cursor.value.temporaryUntil && cursor.value.temporaryUntil <= Date.now()) cursor.delete();
            cursor.continue();
          }
        };
      }),
      dropTemporary: (id, savedAt) => write((posts, assets) => {
        const post = posts.get(id);
        post.onsuccess = () => {
          if (!post.result || post.result.savedAt !== savedAt) return;
          const request = assets.index("postId").openCursor(IDBKeyRange.only(id));
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              if (cursor.value.temporaryUntil) cursor.delete();
              cursor.continue();
            }
          };
        };
      })
    };
  }

  // src/lib/library/types.ts
  var defaultPreferences = { aiEnabled: true, reminders: true, cadence: "daily", ageDays: 0 };

  // src/lib/inspection/enrichment.ts
  var strings = { type: "array", items: { type: "string" } };
  var nullableString = { type: ["string", "null"] };
  var enrichmentSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      category: nullableString,
      topics: strings,
      visualDescription: nullableString,
      slides: { type: "array", items: {
        type: "object",
        additionalProperties: false,
        properties: { position: { type: ["integer", "null"] }, summary: nullableString, keyInsights: strings },
        required: ["position", "summary", "keyInsights"]
      } },
      objects: { type: "array", items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: nullableString,
          type: nullableString,
          position: {
            type: "object",
            additionalProperties: false,
            properties: { slide: { type: ["integer", "null"] }, region: nullableString },
            required: ["slide", "region"]
          },
          attributes: strings,
          evidence: { type: "array", items: {
            type: "object",
            additionalProperties: false,
            properties: { claim: { type: "string" }, source: { type: "string", enum: ["visual", "visible_text", "caption"] }, text: nullableString },
            required: ["claim", "source", "text"]
          } }
        },
        required: ["name", "type", "position", "attributes", "evidence"]
      } },
      brands: { type: "array", items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string" }, sources: { type: "array", items: { type: "string", enum: ["visual", "visible_text", "caption", "author_metadata"] } } },
        required: ["name", "sources"]
      } },
      visibleText: strings,
      rawVisibleText: strings,
      visualKeywords: strings,
      searchableKeywords: strings,
      captionContext: {
        type: "object",
        additionalProperties: false,
        properties: { summary: nullableString, productNames: strings, locations: strings },
        required: ["summary", "productNames", "locations"]
      }
    },
    required: ["category", "topics", "visualDescription", "slides", "objects", "brands", "visibleText", "rawVisibleText", "visualKeywords", "searchableKeywords", "captionContext"]
  };

  // src/lib/library/enrichment.ts
  function parseEnrichment(value) {
    function validate(input, schema, depth = 0) {
      if (depth > 15) return false;
      const kind = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => type === kind || type === "integer" && Number.isSafeInteger(input))) return false;
      if (schema.enum && !schema.enum.includes(input)) return false;
      if (typeof input === "string" && input.length > 64e3) return false;
      if (Array.isArray(input)) return input.length <= 2e3 && input.every((item) => schema.items && validate(item, schema.items, depth + 1));
      if (kind === "object") {
        const object = input;
        if (schema.required?.some((key2) => !Object.hasOwn(object, key2))) return false;
        return Object.entries(object).every(([key2, item]) => schema.properties?.[key2] ? validate(item, schema.properties[key2], depth + 1) : schema.additionalProperties !== false);
      }
      return true;
    }
    if (!validate(value, enrichmentSchema)) throw new Error("AI returned an incomplete result. Try organizing this post again.");
    return value;
  }

  // src/lib/library/review.ts
  var REVIEW_DEMO_INTERVAL_MS = 3 * 60 * 1e3;
  function reviewIntervalMs(cadence) {
    return cadence === "daily" ? REVIEW_DEMO_INTERVAL_MS : (cadence === "weekly" ? 7 : 30) * 864e5;
  }

  // extension/library.ts
  var savedLibrary = libraryStore("memoar-library");
  async function preferences() {
    const stored = await chrome.storage.local.get(["preferences", "reviewDefaultsApplied"]);
    const prefs = { ...defaultPreferences, ...stored.preferences, aiEnabled: true, reminders: true };
    if (stored.reviewDefaultsApplied !== true) {
      prefs.cadence = "daily";
      prefs.ageDays = 0;
      await chrome.storage.local.set({ preferences: prefs, reviewDefaultsApplied: true });
    }
    return prefs;
  }
  async function saveToLibrary(captureId, capture) {
    const parsed = parsePostUrl(capture.inspection.normalizedUrl);
    const id = `${parsed.platform}:${parsed.postId}`;
    const previous = await savedLibrary.get(id);
    if (previous) return previous;
    const prefs = await preferences();
    const assets = [];
    let note = null;
    const manifest = await claimMediaTransfer(captureId) ?? [];
    let storedImages = 0;
    for (const asset of manifest) {
      const video = asset.mimeType === "video/mp4";
      if (!video && storedImages + asset.byteLength > 12 * 1024 * 1024 || video && !prefs.aiEnabled) {
        note = "Some media is available only through the original post.";
        continue;
      }
      try {
        const bytes = new Uint8Array(asset.byteLength);
        for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_BYTES) {
          const chunk = await transferMedia({ type: "TAKE_MEDIA_CHUNK", captureId, itemIndex: asset.itemIndex, offset });
          const decoded = atob(chunk.base64 ?? "");
          if (decoded.length !== Math.min(MEDIA_CHUNK_BYTES, bytes.length - offset)) throw new Error("Incomplete media.");
          for (let i = 0; i < decoded.length; i++) bytes[offset + i] = decoded.charCodeAt(i);
        }
        assets.push({ itemIndex: asset.itemIndex, mimeType: asset.mimeType, blob: new Blob([bytes], { type: asset.mimeType }), ...video ? { temporaryUntil: Date.now() + 864e5 } : {} });
        if (!video) storedImages += asset.byteLength;
      } catch {
        note = "Some media could not be stored. Your captured text and available preview are saved.";
      }
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const post = {
      version: 1,
      id,
      capture,
      savedAt: now,
      updatedAt: now,
      aiStatus: "pending",
      aiConsent: prefs.aiEnabled,
      aiError: null,
      enrichment: null,
      attempts: 0,
      nextAttemptAt: 0,
      leaseUntil: 0,
      model: null,
      mediaStored: assets.filter((asset) => !asset.temporaryUntil).map((asset) => asset.itemIndex),
      mediaNote: note
    };
    await savedLibrary.put(post, assets);
    return post;
  }
  var working = false;
  async function runEnrichmentQueue() {
    if (working) return;
    working = true;
    try {
      await savedLibrary.purgeTemporary();
      if (!(await preferences()).aiEnabled) return;
      for (const item of await savedLibrary.list()) {
        if (!item.aiConsent) await savedLibrary.update(item.id, (value) => ({ ...value, aiConsent: true, nextAttemptAt: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        if (item.aiStatus === "processing" && item.leaseUntil <= Date.now() && item.attempts >= 3) await savedLibrary.update(item.id, (value) => ({ ...value, aiStatus: "failed_terminal", aiError: "Processing was interrupted. Retry organizing when ready.", leaseUntil: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
      }
      const token = (await chrome.storage.local.get("enrichmentAccessCode")).enrichmentAccessCode;
      const post = (await savedLibrary.list()).find((item) => item.aiConsent && item.nextAttemptAt <= Date.now() && (item.aiStatus === "pending" || item.aiStatus === "failed_retryable" || item.aiStatus === "processing" && item.leaseUntil <= Date.now()) && item.attempts < 3);
      if (!post) return;
      if (typeof token !== "string" || !token) {
        await savedLibrary.update(post.id, (value) => ({ ...value, aiStatus: "failed_retryable", aiError: "Open Memoar to connect background organizing.", nextAttemptAt: Date.now() + 3e5, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        return;
      }
      await savedLibrary.update(post.id, (value) => ({ ...value, aiStatus: "processing", attempts: value.attempts + 1, leaseUntil: Date.now() + 3e5, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
      const keepAlive = setInterval(() => {
        void chrome.runtime.getPlatformInfo().catch(() => {
        });
      }, 2e4);
      try {
        const form = new FormData();
        form.set("capture", JSON.stringify(post.capture));
        for (const asset of await savedLibrary.assets(post.id)) form.append(`media-${asset.itemIndex}`, asset.blob, `slide-${asset.itemIndex}.${asset.mimeType === "video/mp4" ? "mp4" : "image"}`);
        const response = await fetch(`${MEMOAR_ORIGIN}/api/enrich`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, redirect: "error", signal: AbortSignal.timeout(24e4) });
        if (!response.ok) {
          if (response.status === 413) throw new Error("This post is too large for the AI server. Your post remains saved; hosted processing supports requests up to 4 MiB.");
          const failure = await response.json();
          throw new Error(typeof failure.error === "string" ? failure.error : "AI processing is temporarily unavailable.");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("AI processing returned no result.");
        const decoder = new TextDecoder();
        let buffer = "", result;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            if (buffer.length > 2 * 1024 * 1024) throw new Error("AI result exceeded its size limit.");
            let end;
            while ((end = buffer.indexOf("\n")) >= 0) {
              const line = buffer.slice(0, end);
              buffer = buffer.slice(end + 1);
              if (!line.trim()) continue;
              const event = JSON.parse(line);
              if (event.type === "result") result = event;
            }
          }
        } finally {
          reader.releaseLock();
        }
        if (!result?.ok) throw new Error(result?.error || "AI processing was interrupted. Try again.");
        const enrichment = parseEnrichment(result.enrichment);
        await savedLibrary.update(post.id, (value) => value.savedAt !== post.savedAt ? value : { ...value, aiStatus: "completed", enrichment, model: "muse-spark-1.3", aiInputNote: result?.inputNote, aiError: null, leaseUntil: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        await savedLibrary.dropTemporary(post.id, post.savedAt);
      } catch (error) {
        await savedLibrary.update(post.id, (value) => value.savedAt !== post.savedAt ? value : { ...value, aiStatus: value.attempts >= 3 ? "failed_terminal" : "failed_retryable", aiError: error instanceof Error ? error.message.slice(0, 300) : "Could not organize this post.", leaseUntil: 0, nextAttemptAt: Date.now() + value.attempts * 6e4, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
      } finally {
        clearInterval(keepAlive);
      }
    } finally {
      working = false;
    }
  }
  async function libraryMessage(request) {
    switch (request.type) {
      case "MEMOAR_TEST_NOTIFICATION":
      case "MEMOAR_NOTIFICATION_STATUS":
        throw new Error("Notification requests must be handled by the background worker.");
      case "MEMOAR_SET_ACCESS_CODE":
        await chrome.storage.local.set({ enrichmentAccessCode: request.code });
        for (const post of await savedLibrary.list()) if (post.aiConsent && post.aiStatus === "failed_retryable" && post.attempts === 0) await savedLibrary.update(post.id, (value) => ({ ...value, aiStatus: "pending", aiError: null, nextAttemptAt: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        return {};
      case "MEMOAR_PING":
        return { protocolVersion: 1, version: chrome.runtime.getManifest().version };
      case "MEMOAR_LIBRARY_SUMMARY": {
        const posts = await savedLibrary.list();
        return { count: posts.length, revision: posts.map((post) => `${post.id}:${post.updatedAt}`).sort().join("|") };
      }
      case "MEMOAR_LIST_POSTS": {
        const posts = (await savedLibrary.list()).sort((a, b) => a.id.localeCompare(b.id));
        return { posts: posts.slice(request.offset, request.offset + 4), total: posts.length };
      }
      case "MEMOAR_GET_POST":
        return { post: await savedLibrary.get(request.id) ?? null };
      case "MEMOAR_GET_ASSET": {
        const asset = (await savedLibrary.assets(request.id)).find((item) => item.itemIndex === request.itemIndex && !item.temporaryUntil);
        if (!asset || request.offset >= asset.blob.size || request.offset % MEDIA_CHUNK_BYTES) throw new Error("Saved image is unavailable.");
        const bytes = new Uint8Array(await asset.blob.slice(request.offset, request.offset + MEDIA_CHUNK_BYTES).arrayBuffer());
        let text = "";
        for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return { base64: btoa(text), byteLength: asset.blob.size, mimeType: asset.mimeType };
      }
      case "MEMOAR_DELETE_POST":
        await savedLibrary.remove(request.id);
        return {};
      case "MEMOAR_CLEAR":
        await savedLibrary.clear();
        return {};
      case "MEMOAR_REVIEW": {
        const interval = reviewIntervalMs((await preferences()).cadence);
        await savedLibrary.update(request.id, (post) => ({ ...post, ...request.action === "open" ? { lastOpenedAt: (/* @__PURE__ */ new Date()).toISOString() } : request.action === "keep" ? { lastReviewedAt: (/* @__PURE__ */ new Date()).toISOString(), remindAfter: void 0 } : { remindAfter: new Date(Date.now() + interval).toISOString() }, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        return {};
      }
      case "MEMOAR_RETRY_AI":
        await savedLibrary.update(request.id, (post) => ({ ...post, aiStatus: "pending", aiConsent: true, attempts: 0, nextAttemptAt: 0, aiError: null, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        return {};
      case "MEMOAR_PREFERENCES":
        return { preferences: await preferences() };
      case "MEMOAR_SET_PREFERENCES": {
        const prefs = { aiEnabled: true, reminders: true, cadence: request.cadence, ageDays: request.ageDays };
        await chrome.storage.local.set({ preferences: prefs });
        if (prefs.aiEnabled) {
          for (const post of await savedLibrary.list()) if (!post.aiConsent) await savedLibrary.update(post.id, (value) => ({ ...value, aiConsent: true, nextAttemptAt: 0, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
        }
        return { preferences: prefs };
      }
    }
  }

  // src/lib/library/protocol.ts
  function isLibraryRequest(value) {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    const only = (...keys) => Object.keys(value).every((key2) => ["type", ...keys].includes(key2));
    if (["MEMOAR_PING", "MEMOAR_LIBRARY_SUMMARY", "MEMOAR_PREFERENCES", "MEMOAR_CLEAR", "MEMOAR_TEST_NOTIFICATION", "MEMOAR_NOTIFICATION_STATUS"].includes(value.type)) return only();
    if (value.type === "MEMOAR_SET_ACCESS_CODE") return only("code") && typeof value.code === "string" && value.code.length >= 24 && value.code.length <= 256;
    if (value.type === "MEMOAR_LIST_POSTS") return only("offset") && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) <= 1e5;
    if (value.type === "MEMOAR_SET_PREFERENCES") return only("aiEnabled", "reminders", "cadence", "ageDays") && typeof value.aiEnabled === "boolean" && typeof value.reminders === "boolean" && ["daily", "weekly", "monthly"].includes(String(value.cadence)) && [0, 1, 30, 60, 90].includes(Number(value.ageDays));
    if (typeof value.id !== "string" || value.id.length > 300 || !/^(instagram|threads|facebook):[^\s]+$/.test(value.id)) return false;
    if (value.type === "MEMOAR_GET_ASSET") return only("id", "itemIndex", "offset") && Number.isInteger(value.itemIndex) && Number(value.itemIndex) >= 0 && Number(value.itemIndex) < 20 && Number.isSafeInteger(value.offset) && Number(value.offset) >= 0 && Number(value.offset) < 50 * 1024 * 1024;
    if (value.type === "MEMOAR_REVIEW") return only("id", "action") && ["keep", "later", "open"].includes(String(value.action));
    return ["MEMOAR_GET_POST", "MEMOAR_DELETE_POST", "MEMOAR_RETRY_AI"].includes(value.type) && only("id");
  }

  // src/lib/library/search.ts
  var postTitle = (post) => post.enrichment?.slides.find((slide) => slide.summary)?.summary || post.capture.inspection.fields.captionText.value || post.capture.inspection.fields.textContent.value || "Saved post";

  // extension/notifications.ts
  var alarmName = "memoar-revisit";
  var prefix = "memoar-revisit:";
  var intervalMinutes = 3;
  var sending = false;
  async function notificationState() {
    const value = await chrome.storage.local.get("notificationState");
    return value.notificationState ?? {};
  }
  async function ensureNotificationAlarm() {
    const alarm = await chrome.alarms.get(alarmName);
    if (!alarm || alarm.periodInMinutes !== intervalMinutes) await chrome.alarms.create(alarmName, { delayInMinutes: intervalMinutes, periodInMinutes: intervalMinutes });
  }
  async function notificationStatus() {
    const [permission, alarm, state] = await Promise.all([
      chrome.notifications.getPermissionLevel(),
      chrome.alarms.get(alarmName),
      notificationState()
    ]);
    return { permission, intervalMinutes, nextAt: alarm?.scheduledTime ?? null, error: state.error ?? null };
  }
  async function sendSavedPostNotification(test = false) {
    if (sending) throw new Error("A notification is already being sent. Try again in a moment.");
    sending = true;
    try {
      if (await chrome.notifications.getPermissionLevel() !== "granted") throw new Error("Notifications are blocked for Memoar. Allow them in Chrome\u2019s extension settings.");
      const state = await notificationState();
      if (!test && typeof state?.lastSentAt === "number" && Date.now() - state.lastSentAt < intervalMinutes * 6e4) return {};
      const posts = (await savedLibrary.list()).sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id));
      if (!posts.length) {
        if (test) throw new Error("Save a post first so the test notification can open its details.");
        return {};
      }
      const previousIndex = posts.findIndex((post2) => post2.id === state?.postId);
      const post = posts[(previousIndex + 1) % posts.length];
      const active = await chrome.notifications.getAll();
      await Promise.all(Object.keys(active).filter((id) => id.startsWith(prefix)).map((id) => chrome.notifications.clear(id)));
      await chrome.notifications.create(prefix + encodeURIComponent(post.id), {
        type: "basic",
        iconUrl: chrome.runtime.getURL("memoar-icon.png"),
        title: test ? "Memoar \xB7 Test notification" : "Worth revisiting?",
        message: postTitle(post).replace(/\s+/g, " ").trim().slice(0, 160),
        contextMessage: "Click to open this saved post in Memoar."
      });
      await chrome.storage.local.set({ notificationState: { postId: post.id, lastSentAt: Date.now(), error: null } });
      return { postId: post.id };
    } catch (error) {
      const previous = await notificationState();
      await chrome.storage.local.set({ notificationState: { ...previous, error: error instanceof Error ? error.message : "Could not send a notification." } });
      throw error;
    } finally {
      sending = false;
    }
  }
  function initializeNotifications() {
    const schedule = () => {
      void ensureNotificationAlarm().catch(() => {
      });
    };
    chrome.runtime.onInstalled.addListener(schedule);
    chrome.runtime.onStartup.addListener(schedule);
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === alarmName) void sendSavedPostNotification().catch(() => {
      });
    });
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (!notificationId.startsWith(prefix)) return;
      void (async () => {
        const id = decodeURIComponent(notificationId.slice(prefix.length));
        const post = await savedLibrary.get(id);
        const url = new URL(post ? `/app/saved/${encodeURIComponent(post.id)}` : "/app/explore", MEMOAR_ORIGIN);
        url.searchParams.set("extensionId", chrome.runtime.id);
        await chrome.tabs.create({ url: url.href });
        await chrome.notifications.clear(notificationId);
      })().catch(() => {
      });
    });
    schedule();
  }

  // extension/background.ts
  initializeNotifications();
  var session = createCaptureSession({
    get: async () => (await chrome.storage.session.get("pending")).pending ?? null,
    set: async (value) => {
      await chrome.storage.session.set({ pending: value });
    },
    clear: async () => {
      await chrome.storage.session.remove("pending");
    }
  });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void session.peek();
  chrome.runtime.onStartup.addListener(() => {
    void session.peek();
  });
  var resumeQueue = () => {
    void runEnrichmentQueue().catch(() => {
    });
  };
  chrome.runtime.onStartup.addListener(resumeQueue);
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.alarms.create("memoar-enrichment", { periodInMinutes: 1 });
    resumeQueue();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "memoar-enrichment") resumeQueue();
  });
  void chrome.alarms.create("memoar-enrichment", { periodInMinutes: 1 });
  chrome.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    const tabId = tab.id;
    void chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "ISOLATED", files: ["popover.js"] }).then(() => {
      void chrome.action.setBadgeText({ tabId, text: "" });
      void chrome.action.setTitle({ tabId, title: "Memoar" });
    }).catch(() => {
      void chrome.action.setBadgeText({ tabId, text: "!" });
      void chrome.action.setBadgeBackgroundColor({ tabId, color: "#30779d" });
      void chrome.action.setTitle({ tabId, title: "Memoar cannot open on this browser page. Open a social post and try again." });
    });
  });
  var pending = null;
  var capturing = false;
  async function startCapture(allSlides, save = false, sourceTabId, expectedUrl) {
    if (capturing) throw new Error("A capture is already running. Wait a moment and try again.");
    capturing = true;
    try {
      return await performCapture(allSlides, save, sourceTabId, expectedUrl);
    } finally {
      capturing = false;
    }
  }
  async function performCapture(allSlides, save, sourceTabId, expectedUrl) {
    if (pending) throw new Error("A capture is already running. Wait a moment and try again.");
    const tab = sourceTabId === void 0 ? (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] : await chrome.tabs.get(sourceTabId);
    if (!tab?.id || !tab.url) throw new Error("No supported active tab is available.");
    if (expectedUrl && !samePost(tab.url, parsePostUrl(expectedUrl))) throw new Error("The post changed. Close and reopen Memoar before saving.");
    parsePostUrl(tab.url);
    const tabId = tab.id;
    const url = tab.url;
    const nonce = crypto.randomUUID();
    let timeout;
    const completed = new Promise((resolve, reject) => {
      pending = { tabId, url, nonce, resolve, reject };
      timeout = setTimeout(() => reject(new Error("Capture timed out. Open the post fully and try again.")), 55e3);
    });
    const outcome = completed.then((value) => ({ value }), (error) => ({ error }));
    try {
      await chrome.scripting.executeScript({
        target: { tabId, frameIds: [0] },
        world: "ISOLATED",
        func: (request) => {
          globalThis.__memoarCaptureRequest = request;
        },
        args: [{ nonce, url, allSlides }]
      });
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "ISOLATED", files: ["capture.js"] });
      const result = await outcome;
      if ("error" in result) throw result.error;
      const latest = await chrome.tabs.get(tabId);
      if (!latest.url || !samePost(latest.url, parsePostUrl(url))) throw new Error("The tab navigated during capture. Capture discarded.");
      if (!isRecord(result.value)) throw new Error("Invalid capture result.");
      const payload = normalizeCapture(result.value.payload);
      const snapshot = await takeSnapshot(tabId, tab.windowId, latest.url, result.value.candidate);
      const afterSnapshot = await chrome.tabs.get(tabId);
      if (afterSnapshot.url !== latest.url) throw new Error("The tab navigated during snapshot. Capture discarded.");
      let envelope;
      try {
        envelope = normalizeCapture({ ...payload, snapshot });
      } catch {
        envelope = normalizeCapture({ ...payload, snapshot: { status: "unavailable", reason: "Snapshot was omitted to keep the capture within its size limit." } });
      }
      const capture = await session.put(envelope);
      await rememberMediaTransfer(capture.id, capture.payload, tabId, url, nonce, capture.expiresAt, result.value.mediaAssets);
      if (save) {
        const id = `${payload.inspection.platform}:${payload.inspection.fields.postId.value}`;
        const duplicate = Boolean(await savedLibrary.get(id));
        const post = await saveToLibrary(capture.id, capture.payload);
        return { postId: post.id, duplicate, aiStatus: post.aiStatus };
      }
      return { captureId: capture.id, payload: capture.payload, expiresAt: capture.expiresAt };
    } finally {
      clearTimeout(timeout);
      pending = null;
    }
  }
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isRecord(message) || sender.id !== chrome.runtime.id) return false;
    if ((message.type === "CAPTURE_RESULT" || message.type === "CAPTURE_ERROR") && pending && message.nonce === pending.nonce && sender.tab?.id === pending.tabId && sender.frameId === 0 && sender.url && samePost(sender.url, parsePostUrl(pending.url))) {
      if (message.type === "CAPTURE_RESULT") {
        try {
          pending.resolve({ payload: normalizeCapture(message.payload), candidate: message.candidate ?? null, mediaAssets: message.mediaAssets });
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error("Invalid capture."));
        }
      } else pending.reject(new Error(typeof message.message === "string" ? message.message.slice(0, 1e3) : "Capture failed."));
      sendResponse({ ok: true });
      return false;
    }
    const fromPopover = Boolean(sender.tab?.id && sender.frameId === 0 && sender.url && /^https?:/.test(sender.url));
    const fromPopup = !sender.tab && sender.url === chrome.runtime.getURL("popup.html");
    if (!fromPopup && !fromPopover) return false;
    if (fromPopover && !["SAVE_POST", "FIND_SAVED", "OPEN_LIBRARY"].includes(String(message.type))) return false;
    const action = message.type === "OPEN_LIBRARY" ? Promise.resolve().then(async () => {
      const post = typeof message.postId === "string" ? await savedLibrary.get(message.postId) : void 0;
      const url = new URL(post ? `/app/saved/${encodeURIComponent(post.id)}` : "/setup", MEMOAR_ORIGIN);
      url.searchParams.set("extensionId", chrome.runtime.id);
      await chrome.tabs.create({ url: url.href });
      return {};
    }) : message.type === "SAVE_POST" ? Promise.resolve().then(() => {
      if (fromPopover && typeof message.url !== "string") throw new Error("Reopen Memoar on the post you want to save.");
      return startCapture(true, true, fromPopover ? sender.tab.id : void 0, fromPopover ? message.url : void 0);
    }) : message.type === "FIND_SAVED" && typeof message.url === "string" ? Promise.resolve().then(async () => {
      const parsed = parsePostUrl(fromPopover ? sender.url : message.url);
      return { post: await savedLibrary.get(`${parsed.platform}:${parsed.postId}`) ?? null };
    }) : message.type === "START_CAPTURE" ? startCapture(message.allSlides === true) : message.type === "LAST_CAPTURE" ? session.peek().then((value) => value ? { captureId: value.id, payload: value.payload, expiresAt: value.expiresAt } : null) : null;
    if (!action) return false;
    void action.then((result) => {
      try {
        sendResponse({ ok: true, result });
      } finally {
        if (message.type === "SAVE_POST") resumeQueue();
      }
    }, (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Capture failed." }));
    return true;
  });
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (!isMemoarSender(sender)) return false;
    const action = isLibraryRequest(message) ? message.type === "MEMOAR_TEST_NOTIFICATION" ? sendSavedPostNotification(true) : message.type === "MEMOAR_NOTIFICATION_STATUS" ? notificationStatus() : libraryMessage(message) : isTakeRequest(message) ? session.take(message.captureId).then(async (payload) => ({ payload, mediaAssets: await claimMediaTransfer(message.captureId) })) : isMediaTransferRequest(message) ? transferMedia(message) : null;
    if (!action) return false;
    void action.then(
      (result) => {
        sendResponse({ ok: true, ...result });
        resumeQueue();
      },
      (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Capture unavailable." })
    );
    return true;
  });
})();
