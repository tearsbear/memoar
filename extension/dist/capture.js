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
  var CAPTURE_TTL_MS = 5 * 60 * 1e3;
  var MAX_CAPTURE_BYTES = 256 * 1024;
  var MAX_TEXT_CHARS = 32e3;
  var MAX_URL_CHARS = 4096;
  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function captureBytes(value) {
    return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
  }

  // src/lib/capture/snapshot.ts
  var MAX_SNAPSHOT_CHARS = 128 * 1024;
  function validateRegion(input) {
    if (!isRecord(input)) throw new Error("No visible media region was identified.");
    const result = {};
    for (const key of ["x", "y", "width", "height", "viewportWidth", "viewportHeight", "scrollX", "scrollY"]) {
      const value = input[key];
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e6) throw new Error("Invalid snapshot region.");
      result[key] = value;
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
  function inspectMp4(bytes) {
    if (!bytes.length || bytes.length > MAX_VIDEO_BYTES) throw new Error("MP4 is empty or exceeds 25 MiB.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const uint64 = (offset) => {
      const value = Number(view.getBigUint64(offset));
      if (!Number.isSafeInteger(value)) throw new Error("MP4 integer exceeds supported bounds.");
      return value;
    };
    let boxCount = 0;
    const boxes = (start, end) => {
      const result = [];
      while (start < end) {
        if (++boxCount > 1e4 || start + 8 > end) throw new Error("Invalid or excessive MP4 boxes.");
        let size = view.getUint32(start), header = 8;
        if (size === 1) {
          if (start + 16 > end) throw new Error("Truncated MP4 box.");
          size = uint64(start + 8);
          header = 16;
        } else if (size === 0) size = end - start;
        if (size < header || start + size > end) throw new Error("Truncated MP4 box.");
        result.push({ type: new TextDecoder().decode(bytes.subarray(start + 4, start + 8)), start, data: start + header, end: start + size });
        start += size;
      }
      return result;
    };
    const only = (list, type) => {
      const found = list.filter((box) => box.type === type);
      if (found.length !== 1) throw new Error(`Missing or ambiguous MP4 ${type}.`);
      return found[0];
    };
    const requireBytes = (box, length) => {
      if (box.end - box.data < length) throw new Error(`Truncated MP4 ${box.type}.`);
    };
    const table = (box, stride) => {
      requireBytes(box, 8);
      const count = view.getUint32(box.data + 4);
      if (!count || count > 1e6 || box.data + 8 + count * stride !== box.end) throw new Error(`Invalid MP4 ${box.type} table.`);
      return count;
    };
    const top = boxes(0, bytes.length);
    const ftyp = only(top, "ftyp");
    requireBytes(ftyp, 8);
    const moov = only(top, "moov");
    const data = top.filter((box) => box.type === "mdat" && box.end > box.data);
    const movie = boxes(moov.data, moov.end);
    if (!data.length || top.some((box) => box.type === "moof") || movie.some((box) => box.type === "mvex")) throw new Error("Fragmented/DASH MP4 is not a complete progressive file.");
    const ranges = [];
    let video;
    let audio = false;
    for (const trak of movie.filter((box) => box.type === "trak")) {
      const mdia = only(boxes(trak.data, trak.end), "mdia");
      const track = boxes(mdia.data, mdia.end);
      const hdlr = only(track, "hdlr");
      requireBytes(hdlr, 12);
      const kind = new TextDecoder().decode(bytes.subarray(hdlr.data + 8, hdlr.data + 12));
      if (!["vide", "soun"].includes(kind)) throw new Error("Unsupported MP4 track type.");
      const mdhd = only(track, "mdhd");
      requireBytes(mdhd, 20);
      const version = bytes[mdhd.data];
      if (version > 1) throw new Error("Unsupported MP4 timing version.");
      if (version === 1) requireBytes(mdhd, 32);
      const scale = view.getUint32(mdhd.data + (version === 1 ? 20 : 12));
      const duration = version === 1 ? uint64(mdhd.data + 24) : view.getUint32(mdhd.data + 16);
      const durationSeconds = duration / scale;
      if (!scale || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 86400) throw new Error("Invalid MP4 duration.");
      const minf = only(track, "minf");
      const stbl = only(boxes(minf.data, minf.end), "stbl");
      const samples = boxes(stbl.data, stbl.end);
      const stsd = only(samples, "stsd");
      requireBytes(stsd, 8);
      const entries = boxes(stsd.data + 8, stsd.end);
      if (view.getUint32(stsd.data + 4) !== 1 || entries.length !== 1) throw new Error("Unsupported MP4 sample descriptions.");
      const entry = entries[0];
      if (!(kind === "vide" ? ["avc1", "avc3", "hvc1", "hev1", "av01", "vp09"] : ["mp4a", "Opus"]).includes(entry.type)) throw new Error("Encrypted or unsupported MP4 codec.");
      if (kind === "vide") {
        requireBytes(entry, 78);
        const width = view.getUint16(entry.data + 24), height = view.getUint16(entry.data + 26);
        if (!width || !height || width > 5e4 || height > 5e4 || video) throw new Error("Invalid or multiple MP4 video tracks.");
        if (boxes(entry.data + 78, entry.end).some((box) => box.type === "sinf")) throw new Error("Protected MP4 video.");
        video = { width, height, durationSeconds, audio: "absent" };
      } else {
        requireBytes(entry, 28);
        if (view.getUint16(entry.data + 8) !== 0) throw new Error("Unsupported MP4 audio sample version.");
        if (boxes(entry.data + 28, entry.end).some((box) => box.type === "sinf")) throw new Error("Protected MP4 audio.");
        audio = true;
      }
      const stsz = only(samples, "stsz");
      requireBytes(stsz, 12);
      const fixed = view.getUint32(stsz.data + 4), count = view.getUint32(stsz.data + 8);
      if (!count || count > 1e6 || stsz.data + 12 + (fixed ? 0 : count * 4) !== stsz.end) throw new Error("Invalid MP4 sample sizes.");
      const stts = only(samples, "stts"), timingCount = table(stts, 8);
      let timedSamples = 0, ticks = 0;
      for (let i = 0; i < timingCount; i++) {
        const n = view.getUint32(stts.data + 8 + i * 8), delta = view.getUint32(stts.data + 12 + i * 8);
        if (!n || !delta) throw new Error("Invalid MP4 sample timing.");
        timedSamples += n;
        ticks += n * delta;
      }
      if (timedSamples !== count || ticks !== duration) throw new Error("Inconsistent MP4 duration or sample count.");
      const offsets = samples.filter((box) => ["stco", "co64"].includes(box.type));
      if (offsets.length !== 1) throw new Error("Unsupported MP4 chunk offsets.");
      const offsetBox = offsets[0], stride = offsetBox.type === "co64" ? 8 : 4, chunks = table(offsetBox, stride);
      const stsc = only(samples, "stsc"), mappings = table(stsc, 12);
      const mapping = [];
      for (let i = 0; i < mappings; i++) {
        const offset = stsc.data + 8 + i * 12, first = view.getUint32(offset), n = view.getUint32(offset + 4);
        if (!n || first > chunks || (i === 0 ? first !== 1 : first <= mapping[i - 1].first) || view.getUint32(offset + 8) !== 1) throw new Error("Invalid MP4 chunk mapping.");
        mapping.push({ first, count: n });
      }
      let sample = 0, mappingIndex = 0;
      for (let chunk = 1; chunk <= chunks; chunk++) {
        if (mapping[mappingIndex + 1]?.first === chunk) mappingIndex++;
        const n = mapping[mappingIndex].count;
        if (sample + n > count) throw new Error("MP4 sample count exceeds its table.");
        const offset = offsetBox.data + 8 + (chunk - 1) * stride;
        const start = stride === 8 ? uint64(offset) : view.getUint32(offset);
        let size = 0;
        for (let i = 0; i < n; i++, sample++) {
          const length = fixed || view.getUint32(stsz.data + 12 + sample * 4);
          if (!length) throw new Error("Empty MP4 sample.");
          size += length;
        }
        if (!data.some((box) => start >= box.data && start + size <= box.end)) throw new Error("MP4 sample bytes are missing or truncated.");
        ranges.push({ start, end: start + size });
      }
      if (sample !== count) throw new Error("MP4 samples are incomplete.");
    }
    ranges.sort((a, b) => a.start - b.start);
    if (ranges.some((range, i) => i > 0 && range.start < ranges[i - 1].end)) throw new Error("Overlapping MP4 samples.");
    if (!video) throw new Error("MP4 has no video samples.");
    return { ...video, audio: audio ? "present" : "absent" };
  }
  async function mediaDigest(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function decodeMp4(blob, signal) {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(blob);
      const cleanup = () => {
        signal.removeEventListener("abort", aborted);
        video.onloadeddata = video.onerror = null;
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(url);
      };
      const aborted = () => {
        cleanup();
        reject(new Error("MP4 decoding timed out."));
      };
      video.onloadeddata = () => {
        const metadata = { width: video.videoWidth, height: video.videoHeight, duration: video.duration };
        cleanup();
        if (!metadata.width || !metadata.height || !Number.isFinite(metadata.duration) || metadata.duration <= 0) reject(new Error("MP4 could not be decoded."));
        else resolve(metadata);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("MP4 codec or sample decoding failed."));
      };
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }
      video.preload = "auto";
      video.muted = true;
      video.src = url;
      video.load();
    });
  }

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

  // extension/adapters/dom.ts
  function visible(element) {
    if (element.closest('[hidden], [aria-hidden="true"], script, style, template')) return false;
    const view = element.ownerDocument.defaultView;
    if (!view) return false;
    const style = view.getComputedStyle(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const inherited = view.getComputedStyle(parent);
      if (inherited.display === "none" || inherited.opacity === "0" || inherited.visibility === "hidden") return false;
    }
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse" && style.opacity !== "0" && element.getClientRects().length > 0 && box.bottom > 0 && box.right > 0 && box.top < view.innerHeight && box.left < view.innerWidth;
  }
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
  var excludedContext = 'aside, nav, [role="navigation"], [role="complementary"], [role="comment"], [contenteditable="true"], form';
  var postBoundary = 'article, [role="article"], [data-pressable-container="true"]';
  function profileUrl(link, expected) {
    try {
      const url = new URL(link.getAttribute("href"), expected.normalizedUrl);
      if (url.origin !== new URL(expected.normalizedUrl).origin || url.username || url.password || url.hash) return null;
      if (expected.platform === "instagram" && /^\/[A-Za-z0-9_.]+\/reels\/?$/.test(url.pathname)) url.pathname = url.pathname.replace(/reels\/?$/, "");
      const pattern = expected.platform === "threads" ? /^\/@[A-Za-z0-9_.]+\/?$/ : /^\/[A-Za-z0-9_.]+\/?$/;
      if (!pattern.test(url.pathname) || /^\/(explore|accounts|direct|reels|reel|stories|search|activity|insights)\/?$/.test(url.pathname)) return null;
      return url;
    } catch {
      return null;
    }
  }
  function authorHint(root, expected) {
    if (expected.platform === "threads") return /^\/@([^/]+)\/post\//.exec(new URL(expected.normalizedUrl).pathname)?.[1] ?? null;
    const hints = [...root.querySelectorAll("a[href]")].filter((link) => samePost(link.getAttribute("href"), expected)).map((link) => /^\/([^/]+)\/(?:p|reels?)\//.exec(new URL(link.getAttribute("href"), expected.normalizedUrl).pathname)?.[1]).filter((value) => Boolean(value));
    const unique = [...new Set(hints)];
    return unique.length === 1 ? unique[0] : null;
  }
  function belongsToPost(element, root) {
    if (!root.contains(element) || element.closest(excludedContext)) return false;
    const boundary = element.closest(postBoundary);
    return !boundary || boundary === root || !root.contains(boundary);
  }
  function isPostMedia(element, root, expected) {
    if (!belongsToPost(element, root) || element.closest('header, h1, [dir="auto"]') || /profile|avatar|foto profil|ikon|icon/i.test(element.getAttribute("alt") ?? "")) return false;
    const box = element.getBoundingClientRect();
    if (box.width < 96 || box.height < 96 || element.closest('[role="navigation"], [role="complementary"]')) return false;
    const link = element.closest("a[href]");
    if (link && !samePost(link.getAttribute("href"), expected)) return false;
    const item = element.closest('li, [role="listitem"]');
    if (item?.querySelector('time, a[href*="/c/"], a[href*="/comments/"]')) return false;
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const profiles = [...parent.querySelectorAll("a[href]")].some((link2) => profileUrl(link2, expected));
      if (profiles && !item && parent.querySelectorAll("img, video").length === 1 && !parent.querySelector('h1, [dir="auto"], time') && !postLinks(parent, expected).length) return false;
      if (parent.querySelector('a[href*="/c/"], a[href*="/comments/"]') && !postLinks(parent, expected, true).length) return false;
      if (parent.querySelector('textarea, input, [contenteditable="true"], [role="textbox"]') && !parent.querySelector("time") && !postLinks(parent, expected).length) return false;
    }
    return true;
  }
  function postLinks(root, expected, contextOnly = false) {
    return [...root.querySelectorAll("a[href]")].filter((link) => (visible(link) || contextOnly && link.getClientRects().length > 0 && !link.closest('[hidden], [aria-hidden="true"]')) && !link.closest(excludedContext) && samePost(link.getAttribute("href"), expected));
  }
  function hasDifferentPost(root, expected) {
    return [...root.querySelectorAll("a[href]")].some((link) => {
      if (!visible(link) || link.closest(excludedContext)) return false;
      try {
        const parsed = parsePostUrl(new URL(link.getAttribute("href"), expected.normalizedUrl).href);
        return parsed.platform === expected.platform && parsed.postId !== expected.postId;
      } catch {
        return false;
      }
    });
  }
  function postTextBlocks(root) {
    const nodes = [...root.querySelectorAll('h1, span, [dir="auto"], [data-ad-preview="message"], [data-testid="post-text"], [data-testid="post-content"]')].filter((node) => visible(node) && belongsToPost(node, root) && (node.matches("h1") || !node.closest('a, button, [role="button"], time, header')) && !node.querySelector('button, [role="button"], time, input, textarea, [contenteditable="true"]') && [...node.querySelectorAll("a")].every((link) => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? "")) && Boolean(observedText(node)));
    return nodes.filter((node) => !nodes.some((parent) => parent !== node && parent.contains(node)));
  }
  function postRoot(document2, expected) {
    const dialogs = [...document2.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible);
    if (dialogs.length > 1) throw new Error("Multiple visible dialogs prevent safe post capture.");
    const scope = dialogs[0] ?? document2.documentElement;
    const candidates = [scope, ...scope.querySelectorAll(postBoundary)].filter((root) => root.matches(postBoundary) && visible(root) && !root.closest(excludedContext));
    const matching = candidates.filter((root) => postLinks(root, expected, true).length > 0 && !hasDifferentPost(root, expected));
    const unique = matching.filter((root) => !matching.some((other) => other !== root && root.contains(other)));
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) throw new Error("More than one visible post matches this permalink. Open the post on its own.");
    const links = postLinks(scope, expected).filter((link) => Boolean(link.querySelector("time")) || !/^(column title|thread)$/i.test(link.getAttribute("aria-label") ?? link.textContent?.trim() ?? ""));
    const resolved = /* @__PURE__ */ new Set();
    for (const link of links) {
      let textOnly = null;
      for (let root = link.parentElement, depth = 0; root && depth < 18; root = root.parentElement, depth++) {
        if (root === document2.body || root.matches('main, [role="main"], nav, aside') || root.closest(excludedContext) || hasDifferentPost(root, expected)) break;
        if (!scope.contains(root)) break;
        const hasCaption = postTextBlocks(root).length > 0 || expected.platform === "instagram" && [...root.querySelectorAll('h1, [dir="auto"]')].some((node) => visible(node) && belongsToPost(node, root) && !node.closest("a, header") && Boolean(observedText(node, true)));
        if (!authorLink(root, expected) || !hasCaption) continue;
        textOnly ??= root;
        const media = [...root.querySelectorAll("img, video")].some((node) => visible(node) && isPostMedia(node, root, expected));
        if (media) {
          resolved.add(root);
          textOnly = null;
          break;
        }
      }
      if (textOnly) resolved.add(textOnly);
    }
    const roots = [...resolved].filter((root) => ![...resolved].some((other) => other !== root && root.contains(other)));
    if (roots.length === 1) return roots[0];
    if (roots.length > 1) throw new Error("Multiple post containers match this permalink. Capture was stopped to avoid mixing their contents.");
    if (expected.platform === "instagram" && /^\/(?:[^/]+\/)?reel\//.test(new URL(expected.normalizedUrl).pathname)) {
      const players = [...scope.querySelectorAll("video")].filter((node) => {
        const box = node.getBoundingClientRect();
        const view = document2.defaultView;
        const intersection = Math.max(0, Math.min(view.innerWidth, box.right) - Math.max(0, box.left)) * Math.max(0, Math.min(view.innerHeight, box.bottom) - Math.max(0, box.top));
        return visible(node) && box.width >= 160 && box.height >= 160 && intersection >= box.width * box.height * 0.5;
      });
      if (players.length === 1) {
        let candidate = null;
        for (let root = players[0].parentElement, depth = 0; root && depth < 18; root = root.parentElement, depth++) {
          if (!scope.contains(root) || root === document2.body || root.matches('main, [role="main"]') || root.closest(excludedContext) || [...root.querySelectorAll("video")].filter(visible).length !== 1 || hasDifferentPost(root, expected)) break;
          if (authorLink(root, expected)) {
            candidate = root;
            if ([...root.querySelectorAll('h1, [dir="auto"]')].some((node) => visible(node) && belongsToPost(node, root) && !node.closest('a, header, [role="comment"]'))) return root;
          }
        }
        if (candidate) return candidate;
      }
    }
    throw new Error(`The post URL is recognized, but no unambiguous post container could be isolated safely (${candidates.length} semantic containers, ${links.length} matching links). This is an adapter limitation; opening the same permalink again may not resolve it.`);
  }
  function observedText(element, allowInteractiveAncestor = false, preserveBlocks = false) {
    const view = element.ownerDocument.defaultView;
    const style = view.getComputedStyle(element);
    const html = element;
    if (style.getPropertyValue("-webkit-line-clamp") && !["none", "unset", "0"].includes(style.getPropertyValue("-webkit-line-clamp")) || style.textOverflow === "ellipsis" || html.scrollHeight > html.clientHeight && style.overflowY === "hidden") return null;
    if (preserveBlocks) {
      const read = (parent) => {
        let result = "";
        for (const child of parent.childNodes) {
          if (child.nodeType === 3) {
            const control = parent.closest('button, [role="button"], time, [role="comment"], [data-memoar-exclude]');
            if (visible(parent) && (!control || allowInteractiveAncestor && (control === element || !element.contains(control)))) result += child.textContent ?? "";
          } else if (child.nodeType === 1 && visible(child)) {
            const node2 = child;
            if (node2.tagName === "BR") {
              result += "\n";
              continue;
            }
            const content = read(node2);
            const block = /^(DIV|P|LI|UL|OL)$/.test(node2.tagName);
            if (block && content && result && !result.endsWith("\n")) result += "\n";
            result += content;
            if (block && content && !result.endsWith("\n")) result += "\n";
          }
        }
        return result;
      };
      return read(element).trim() || null;
    }
    const walker = element.ownerDocument.createTreeWalker(element, 5);
    let text = "";
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeType === 1) {
        if (node.tagName === "BR" && visible(node)) text += "\n";
        continue;
      }
      const parent = node.parentElement;
      const control = parent?.closest('button, [role="button"], time, [role="comment"], [data-memoar-exclude]');
      if (parent && visible(parent) && (!control || allowInteractiveAncestor && (control === element || !element.contains(control)))) text += node.textContent ?? "";
    }
    return text.trim() || null;
  }
  function collaborationLinks(root, expected) {
    if (expected.platform !== "instagram") return [];
    const groups = /* @__PURE__ */ new Map();
    for (const link of root.querySelectorAll("a[href]")) {
      if (!visible(link) || !profileUrl(link, expected)) continue;
      for (let parent = link.parentElement, depth = 0; parent && root.contains(parent) && depth < 8; parent = parent.parentElement, depth++) {
        const links = [...parent.querySelectorAll("a[href]")].filter((node) => visible(node) && profileUrl(node, expected));
        const handles = links.map((node) => profileUrl(node, expected).pathname.replace(/^\//, "").replace(/\/$/, ""));
        if (handles.length < 2 || handles.length > 10 || new Set(handles).size !== handles.length) continue;
        const label = parent.textContent?.replace(/\s+/g, "") ?? "";
        if (["and", "dan", ","].some((separator) => label === handles.join(separator))) groups.set(handles.join(","), links);
      }
    }
    return groups.size === 1 ? [...groups.values()][0] : [];
  }
  function authorLink(root, expected) {
    const header = root.querySelector("header");
    const hint = authorHint(root, expected);
    const links = [...(header ?? root).querySelectorAll("a[href]")].filter((link) => visible(link) && belongsToPost(link, root) && profileUrl(link, expected) && (expected.platform !== "instagram" || !/^[@#]/.test(link.textContent?.trim() ?? "")));
    if (expected.platform === "instagram" && /^\/(?:[^/]+\/)?reel\//.test(new URL(expected.normalizedUrl).pathname)) {
      const reelProfiles = links.filter((link) => /^\/[A-Za-z0-9_.]+\/reels\/?$/.test(new URL(link.getAttribute("href"), expected.normalizedUrl).pathname));
      if (new Set(reelProfiles.map((link) => profileUrl(link, expected).pathname)).size === 1) return reelProfiles[0];
    }
    const hinted = hint ? links.filter((link) => profileUrl(link, expected).pathname.replace(/^\/@?/, "").replace(/\/$/, "").toLowerCase() === hint.toLowerCase()) : [];
    if (hinted.length) return hinted[0];
    const collaborators = collaborationLinks(root, expected);
    if (collaborators.length) return collaborators[0];
    const handles = [...new Set(links.map((link) => profileUrl(link, expected).pathname.replace(/\/$/, "")))];
    return handles.length === 1 ? links[0] : null;
  }
  function authoredCaption(root, expected, author) {
    if (author) {
      const profile = profileUrl(author, expected);
      const anchors = [...root.querySelectorAll("a[href]")].filter((link) => visible(link) && belongsToPost(link, root) && profileUrl(link, expected)?.pathname.replace(/\/$/, "") === profile.pathname.replace(/\/$/, ""));
      const blocks = /* @__PURE__ */ new Set();
      for (const anchor of anchors) {
        for (let parent = anchor.parentElement, depth = 0; parent && root.contains(parent) && depth < 9; parent = parent.parentElement, depth++) {
          const text2 = postTextBlocks(parent);
          const profiles = [...parent.querySelectorAll("a[href]")].filter((link) => visible(link) && profileUrl(link, expected) && !text2.some((block) => block.contains(link)));
          if (profiles.some((link) => profileUrl(link, expected).pathname.replace(/\/$/, "") !== profile.pathname.replace(/\/$/, ""))) break;
          if ([...parent.querySelectorAll("a[href]")].some((link) => /\/(?:c|comments)\//.test(link.getAttribute("href") ?? ""))) break;
          if (text2.length === 1 && !text2[0].closest("header")) {
            blocks.add(text2[0]);
            break;
          }
          if (parent === root) break;
        }
      }
      if (blocks.size === 1) return { text: observedText([...blocks][0]), textReason: "Visible text in the author-associated post block. Completeness is unverified; no caption expansion was performed." };
    }
    const text = postTextBlocks(root);
    return text.length === 1 ? { text: observedText(text[0]), textReason: "Unique visible text block within the matched post. Completeness is unverified." } : { text: null, textReason: "Post context found, but caption could not be separated safely from other text." };
  }
  function textObservation(root, selector) {
    const nodes = [...root.querySelectorAll(selector)].filter((element) => visible(element) && !element.closest('[role="comment"], aside, [role="complementary"]') && !element.parentElement?.closest('li, [role="listitem"]'));
    if (nodes.length !== 1) return { text: null, textReason: "A unique visible post-text block could not be separated from comments and surrounding content." };
    const text = observedText(nodes[0], nodes[0].matches("h1"));
    return { text, textReason: text ? "Exact observed DOM text. Completeness is unverified; collapsed text is not expanded." : "The text is clipped, hidden, or empty; visible text could not be isolated safely." };
  }

  // extension/media.ts
  function reference(value, parsed) {
    try {
      return value ? validateMediaReference(value, parsed.platform) : null;
    } catch {
      return null;
    }
  }
  function mediaElements(root, parsed) {
    const candidates = [...root.querySelectorAll("img, video")].filter((node) => {
      if (!visible(node) || !isPostMedia(node, root, parsed)) return false;
      const box = node.getBoundingClientRect();
      let left = Math.max(0, box.left), top = Math.max(0, box.top);
      let right = Math.min(root.ownerDocument.defaultView.innerWidth, box.right), bottom = Math.min(root.ownerDocument.defaultView.innerHeight, box.bottom);
      for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        const style = root.ownerDocument.defaultView.getComputedStyle(parent);
        if (/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
          const bounds = parent.getBoundingClientRect();
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
        if (parent === root) break;
      }
      return Math.max(0, right - left) * Math.max(0, bottom - top) >= box.width * box.height * 0.5;
    });
    let media = candidates.filter((node) => node.tagName === "VIDEO" || !candidates.some((video) => video.tagName === "VIDEO" && video.parentElement !== root && video.parentElement?.contains(node)));
    const slideGroups = /* @__PURE__ */ new Map();
    for (const node of media) {
      const slot = node.closest('li, [role="listitem"]');
      if (slot) slideGroups.set(slot, [...slideGroups.get(slot) ?? [], node]);
    }
    for (const group of slideGroups.values()) {
      if (group.length < 2) continue;
      const videos = group.filter((node) => node.tagName === "VIDEO");
      if (videos.length > 1) return [];
      const best = videos[0] ?? [...group].sort((a, b) => b.naturalWidth - a.naturalWidth)[0];
      media = media.filter((node) => !group.includes(node) || node === best);
    }
    if (media.length <= 1) return media;
    const slots = media.map((node) => node.closest('li, [role="listitem"]'));
    if (slots.every((slot) => slot && slot.parentElement === slots[0]?.parentElement)) return media;
    if (media.filter((node) => node.tagName === "VIDEO").length > 1) return [];
    const area = (node) => {
      const box = node.getBoundingClientRect();
      return box.width * box.height;
    };
    const largest = Math.max(...media.map(area));
    const dominant = media.filter((node) => area(node) === largest);
    return dominant.length === 1 ? dominant : [];
  }
  function carouselControl(root, direction) {
    const pattern = direction === "next" ? /^(next|berikutnya)$/i : /^(previous|go back|sebelumnya|kembali)$/i;
    const matches = [...root.querySelectorAll('button, [role="button"]')].filter((node) => visible(node) && !node.closest('header, aside, [role="comment"]') && pattern.test(node.getAttribute("aria-label") ?? "") && !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true");
    return matches.length === 1 ? matches[0] : null;
  }
  function readMedia(root, parsed, carousel) {
    const nodes = mediaElements(root, parsed);
    const list = nodes.map((node) => node.closest('li, [role="listitem"]'));
    const carouselList = list[0]?.parentElement;
    const orderedList = carouselList && list.every((item) => item?.parentElement === carouselList);
    const indicators = [...root.querySelectorAll("[aria-label]")].filter(visible).map((node) => node.getAttribute("aria-label") ?? "");
    const counters = indicators.map((label) => /^(?:slide\s+)?(\d+)\s*(?:of|\/|dari)\s*(\d+)$/i.exec(label)).filter(Boolean);
    const totals = [...new Set(counters.map((match) => Number(match[2])))];
    const setSizes = [...new Set(list.map((item) => Number(item?.getAttribute("aria-setsize"))).filter((value) => value > 0))];
    const isCarousel = carousel || Boolean(orderedList && carouselList.children.length > 1);
    const totalSlides = isCarousel ? totals.length === 1 ? totals[0] : setSizes.length === 1 ? setSizes[0] : null : nodes.length === 1 ? 1 : null;
    const current = counters.length === 1 ? Number(counters[0][1]) : null;
    const items = nodes.map((node) => {
      const video = node.tagName === "VIDEO";
      const slot = node.closest('li, [role="listitem"]');
      const explicit = Number(slot?.getAttribute("aria-posinset"));
      const position = !isCarousel ? 1 : explicit > 0 ? explicit : current && nodes.length === 1 ? current : orderedList && totalSlides === carouselList.children.length ? [...carouselList.children].indexOf(slot) + 1 : null;
      let url;
      let referenceUrl = null;
      if (video) {
        const player = node;
        const sources = [player.currentSrc, player.getAttribute("src") ?? "", ...[...player.querySelectorAll("source")].map((source) => source.getAttribute("src") ?? "")].map((value) => reference(value, parsed)).filter((value) => Boolean(value));
        referenceUrl = sources.find((value) => value.startsWith("blob:")) ?? null;
        url = sources.find((value) => !value.startsWith("blob:")) ?? referenceUrl;
      } else {
        const image = node;
        const sources = (image.getAttribute("srcset") ?? "").split(",").map((part) => {
          const match = /^\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*$/.exec(part);
          return match ? { url: reference(match[1], parsed), size: Number(match[2]), unit: match[3] } : null;
        }).filter((value) => Boolean(value?.url));
        const unit = sources[0]?.unit;
        const best = sources.every((source) => source.unit === unit) ? sources.sort((a, b) => b.size - a.size)[0]?.url : null;
        url = best ?? reference(image.currentSrc || image.getAttribute("src") || "", parsed);
      }
      return {
        position,
        type: video ? "video" : "image",
        url,
        referenceUrl,
        posterUrl: video ? reference(node.getAttribute("poster") ?? "", parsed) : null,
        width: !video && url === (node.currentSrc || node.getAttribute("src")) && node.naturalWidth || video && node.videoWidth || null,
        height: !video && url === (node.currentSrc || node.getAttribute("src")) && node.naturalHeight || video && node.videoHeight || null,
        assetAccess: url ? "reference_only" : "unavailable",
        processingEligibility: "unverified",
        reason: url?.startsWith("blob:") ? "Page-scoped blob player reference; not a reusable file or AI-consumable input." : url ? "Visible media element in the matched post. Independent resource access and MIME type have not been verified." : "The visible slide exposes no supported media URL."
      };
    });
    const unique = items.filter((item, index) => !items.slice(0, index).some((other) => other.url === item.url && other.type === item.type && other.position === item.position));
    const positions = unique.map((item) => item.position);
    const complete = isCarousel ? totalSlides !== null && unique.length === totalSlides && new Set(positions).size === totalSlides && positions.every((position) => position !== null && position >= 1 && position <= totalSlides) && unique.every((item) => item.url) : unique.length === 1 && Boolean(unique[0].url);
    return {
      kind: isCarousel ? "carousel" : "single",
      totalSlides: isCarousel ? totalSlides : unique.length === 1 ? 1 : null,
      composition: !unique.length ? "unknown" : unique.some((item) => item.type === "video") && unique.some((item) => item.type === "image") ? "mixed" : !complete && isCarousel ? "unknown" : unique[0].type === "image" ? "image_only" : "video_only",
      completeness: complete ? "complete" : "partial",
      navigation: "not_requested",
      reason: complete ? "All identified slide positions were observed; resource accessibility is evaluated separately." : "Only visible, identified media was captured; total or remaining media are unknown until safely navigated.",
      items: unique.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity))
    };
  }

  // extension/adapters/instagram-context.ts
  function instagramPostContext(node, root, parsed) {
    if (!visible(node) || !belongsToPost(node, root) || node.closest('li, [role="listitem"]')) return false;
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const links = [...parent.querySelectorAll("a[href]")];
      if (links.some((link) => /\/(?:c|comments)\//.test(link.getAttribute("href") ?? "")) && !links.some((link) => samePost(link.getAttribute("href"), parsed))) return false;
    }
    return true;
  }
  function instagramAudioControls(root, parsed) {
    const controls = /* @__PURE__ */ new Set();
    for (const marker of root.querySelectorAll('svg[aria-label], svg title, [role="button"][aria-label], button[aria-label]')) {
      if (!/^(audio(?: track)?|music|musik|audio asli|original audio)$/i.test(marker.getAttribute("aria-label") ?? marker.textContent?.trim() ?? "")) continue;
      const control = marker.closest('a, button, [role="button"], [role="link"]') ?? marker.closest("svg")?.parentElement;
      if (control && instagramPostContext(control, root, parsed) && !control.querySelector("video, h1, time, textarea")) controls.add(control);
    }
    return [...controls].filter((control) => Boolean(observedText(control, true)));
  }

  // extension/adapters/instagram.ts
  function authorEntryCaption(root, parsed, author) {
    if (!author) return null;
    const path = (link) => {
      try {
        return new URL(link.getAttribute("href"), parsed.normalizedUrl).pathname.replace(/\/reels\/?$/, "/").replace(/\/$/, "");
      } catch {
        return null;
      }
    };
    const audio = instagramAudioControls(root, parsed);
    const candidates = /* @__PURE__ */ new Set();
    for (const anchor of root.querySelectorAll("a[href]")) {
      if (!visible(anchor) || !belongsToPost(anchor, root) || path(anchor) !== path(author) || /^@/.test(anchor.textContent?.trim() ?? "")) continue;
      const item = anchor.closest('li, [role="listitem"]');
      if (item && item !== item.parentElement?.querySelector('li, [role="listitem"]')) continue;
      for (let entry = anchor.parentElement, depth = 0; entry && entry !== root && depth < 8; entry = entry.parentElement, depth++) {
        if (entry.closest('header, aside, [role="comment"]')) break;
        if (entry.querySelector('a[href*="/c/"], a[href*="/comments/"], textarea, input, [contenteditable="true"]')) break;
        if (!item && !entry.querySelector("time")) continue;
        for (const node of entry.querySelectorAll('h1, span, [dir="auto"], div, p')) {
          if (!visible(node) || !belongsToPost(node, root) || node.closest("a, time, header, button") || audio.some((control) => control.contains(node))) continue;
          if (/^(?:edited|diedit|see translation|lihat terjemahan|more|selengkapnya)[\s·•.]*$/i.test(node.textContent?.trim() ?? "")) continue;
          const time = entry.querySelector("time");
          if (time && !(time.compareDocumentPosition(node) & 4)) continue;
          if (node.querySelector("time, img, video, input, textarea")) continue;
          const links = [...node.querySelectorAll("a[href]")];
          if (links.some((link) => !/^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? "") && path(link) === path(author))) continue;
          if (!item && links.some((link) => !/^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? ""))) continue;
          if (observedText(node, true, true)) candidates.add(node);
        }
        if (entry === item) break;
      }
    }
    const outer = [...candidates].filter((node) => ![...candidates].some((other) => other !== node && other.contains(node)));
    return outer.length === 1 ? observedText(outer[0], true, true) : null;
  }
  function instagram(document2, parsed) {
    const root = postRoot(document2, parsed);
    const carousel = [...root.querySelectorAll('button, [role="button"]')].some((node) => visible(node) && /^(next|previous|go back|slide \d+|berikutnya|sebelumnya|kembali)$/i.test(node.getAttribute("aria-label") ?? ""));
    const author = authorLink(root, parsed);
    let text = textObservation(root, "h1");
    if (!text.text && author) {
      const headings = [...root.querySelectorAll("h1")].filter((node) => visible(node) && !node.closest('[role="comment"], aside'));
      if (headings.length === 1) {
        const item = headings[0].closest("li");
        const firstItem = item?.parentElement?.querySelector(":scope > li");
        const authorPath = new URL(author.getAttribute("href"), parsed.normalizedUrl).pathname;
        const authored = item && [...item.querySelectorAll("a[href]")].some((link) => visible(link) && new URL(link.getAttribute("href"), parsed.normalizedUrl).pathname === authorPath);
        if (item && item === firstItem && authored) text = { text: observedText(headings[0], true), textReason: "Observed caption heading in the first author-associated entry. Completeness is unverified; no expansion was performed." };
      }
    }
    if (!text.text) {
      const caption2 = authorEntryCaption(root, parsed, author);
      if (caption2) text = { text: caption2, textReason: "Visible caption in the first author-associated entry, preserving mentions and block formatting. Completeness is unverified; no expansion was performed." };
    }
    if (!text.text) {
      const audio = instagramAudioControls(root, parsed);
      const captions = [...root.querySelectorAll('[dir="auto"]')].filter((node) => instagramPostContext(node, root, parsed) && !node.closest("a, header") && !audio.some((control) => control.contains(node)) && !node.querySelector("video, time, input, textarea") && [...node.querySelectorAll("a")].every((link) => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? "")) && Boolean(observedText(node, true)));
      const outer = captions.filter((node) => !captions.some((other) => other !== node && other.contains(node)));
      if (outer.length === 1) text = { text: observedText(outer[0], true), textReason: "Visible caption in the scoped post. Completeness is unverified; no expansion was performed." };
    }
    if (!text.text) {
      const fallback = authoredCaption(root, parsed, author);
      if (!instagramAudioControls(root, parsed).some((control) => observedText(control, true) === fallback.text)) text = fallback;
    }
    return { root, author, ...text, carousel };
  }

  // extension/threads-json.ts
  function dimension(value) {
    return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 5e4 ? Number(value) : null;
  }
  function versions(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      try {
        const url = validateMediaReference(candidate.url, "threads");
        return url.startsWith("https:") ? [{ url, width: dimension(candidate.width), height: dimension(candidate.height) }] : [];
      } catch {
        return [];
      }
    }).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  }
  function mediaType(node) {
    if (node.media_type === 2 || Array.isArray(node.video_versions) && node.video_versions.length > 0 || typeof node.video_dash_manifest === "string" && node.video_dash_manifest.length > 0) return "video";
    if (node.media_type === 1 || isRecord(node.image_versions2) && Array.isArray(node.image_versions2.candidates) && node.image_versions2.candidates.length > 0) return "image";
    return null;
  }
  function resolvedMedia(node) {
    const carousel = Array.isArray(node.carousel_media) || node.media_type === 8;
    if (!carousel && !mediaType(node)) return null;
    const slides = carousel ? Array.isArray(node.carousel_media) ? node.carousel_media : [] : [node];
    const declared = node.carousel_media_count;
    const count = Number.isInteger(declared) && Number(declared) > 0 && Number(declared) <= 1e3 ? Number(declared) : null;
    const totalSlides = !carousel ? 1 : declared === void 0 ? slides.length > 0 && slides.length <= 1e3 ? slides.length : null : count !== null && count >= slides.length ? count : null;
    const items = [];
    for (const [index, slide] of slides.slice(0, 20).entries()) {
      if (!isRecord(slide)) continue;
      const type = mediaType(slide);
      if (!type) continue;
      const image = versions(isRecord(slide.image_versions2) ? slide.image_versions2.candidates : null)[0];
      const video = versions(slide.video_versions)[0];
      const protectedStream = typeof slide.video_dash_manifest === "string" && /(?:\w+:)?ContentProtection\b/i.test(slide.video_dash_manifest);
      const resource = type === "image" ? image : protectedStream ? void 0 : video;
      items.push({
        position: index + 1,
        type,
        url: resource?.url ?? null,
        referenceUrl: null,
        posterUrl: type === "video" ? image?.url ?? null : null,
        width: resource?.width ?? null,
        height: resource?.height ?? null,
        assetAccess: resource ? "reference_only" : "unavailable",
        processingEligibility: "unverified",
        reason: protectedStream ? "Threads metadata declares content protection. No protected stream was retrieved." : resource ? "Temporary CDN reference from already-loaded Threads JSON matched to the exact post. Bytes and processing permission are unverified." : "Matched Threads media exposes no supported image or complete MP4 URL. No missing resource was invented."
      });
    }
    const complete = totalSlides !== null && items.length === totalSlides && items.every((item) => item.url);
    return {
      discovery: "embedded_json",
      kind: carousel ? "carousel" : "single",
      totalSlides,
      items,
      navigation: "not_requested",
      completeness: complete ? "complete" : "partial",
      composition: !complete ? "unknown" : items.some((item) => item.type === "image") && items.some((item) => item.type === "video") ? "mixed" : items[0].type === "video" ? "video_only" : "image_only",
      reason: complete ? "Threads media order comes from the exact matched post metadata. File accessibility is evaluated separately." : "Matched Threads metadata is incomplete, inconsistent, unsupported, or exceeds the 20-item capture limit. Only identified items retain their original positions."
    };
  }
  function postText(node) {
    const caption2 = isRecord(node.caption) ? node.caption.text : null;
    if (typeof caption2 === "string" && caption2.trim() && caption2.length <= MAX_TEXT_CHARS) return caption2;
    const info = node.text_post_app_info;
    const fragments = isRecord(info) && isRecord(info.text_fragments) ? info.text_fragments.fragments : null;
    if (!Array.isArray(fragments) || !fragments.length || fragments.length > MAX_TEXT_CHARS || !fragments.every((fragment) => isRecord(fragment) && typeof fragment.plaintext === "string")) return null;
    const text = fragments.map((fragment) => fragment.plaintext).join("");
    return text.trim() && text.length <= MAX_TEXT_CHARS ? text : null;
  }
  function threadsJsonPost(document2, parsed) {
    const empty = (reason) => ({ username: null, text: null, media: null, warnings: reason ? [reason] : [] });
    if (parsed.platform !== "threads") return empty();
    let remaining = 12 * 1024 * 1024;
    let visited = 0;
    let found = null;
    for (const script of document2.querySelectorAll("script[data-sjs]")) {
      const text = script.textContent ?? "";
      remaining -= text.length;
      if (remaining < 0) return empty("Threads embedded JSON exceeded the capture read limit. Only scoped DOM fallback is used.");
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      const stack = [json];
      while (stack.length) {
        if (++visited > 1e5) return empty("Threads embedded JSON exceeded the traversal limit. Only scoped DOM fallback is used.");
        const value = stack.pop();
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === "object") stack.push(child);
        } else if (isRecord(value)) {
          const permalink = typeof value.permalink === "string" ? value.permalink : null;
          const postData = isRecord(value.user) || isRecord(value.caption) || isRecord(value.text_post_app_info) || value.media_type !== void 0 || isRecord(value.image_versions2) || Array.isArray(value.video_versions) || Array.isArray(value.carousel_media);
          if (postData && (value.code === parsed.postId || permalink && samePost(permalink, parsed))) {
            if (value.code !== void 0 && value.code !== parsed.postId || permalink && !samePost(permalink, parsed)) {
              return empty("Threads metadata contains conflicting post identities. Only scoped DOM fallback is used.");
            }
            const username = isRecord(value.user) && typeof value.user.username === "string" && /^[A-Za-z0-9_.]{1,64}$/.test(value.user.username) ? value.user.username : null;
            const hint = /^\/@([^/]+)\/post\//.exec(new URL(parsed.normalizedUrl).pathname)?.[1];
            if (username && hint && username.toLowerCase() !== hint.toLowerCase()) return empty("Threads metadata author conflicts with the active permalink. Only scoped DOM fallback is used.");
            const candidate = { username, text: postText(value), media: resolvedMedia(value), warnings: [] };
            if (found && JSON.stringify(found) !== JSON.stringify(candidate)) return empty("Conflicting Threads metadata matches the active post. Only scoped DOM fallback is used.");
            found = candidate;
            continue;
          }
          for (const child of Object.values(value)) if (child && typeof child === "object") stack.push(child);
        }
      }
    }
    return found ?? empty("No unambiguous Threads metadata matched the active post. Only scoped DOM fallback is used.");
  }

  // extension/adapters/threads.ts
  var boundaries = 'article, [role="article"], [data-pressable-container="true"]';
  var excluded = 'blockquote, [data-testid="quoted-post"], [data-testid="quote-post"], aside, nav, [role="comment"], [role="complementary"], form, [contenteditable="true"]';
  function otherPost(link, parsed) {
    try {
      const target = parsePostUrl(new URL(link.getAttribute("href"), parsed.normalizedUrl).href);
      return target.platform === "threads" && target.postId !== parsed.postId;
    } catch {
      return false;
    }
  }
  function inPostContext(node, root, parsed) {
    if (!belongsToPost(node, root) || node.closest(excluded)) return false;
    for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) {
      const links = [...parent.querySelectorAll("a[href]")];
      if (links.some((link) => otherPost(link, parsed)) && !links.some((link) => samePost(link.getAttribute("href"), parsed))) return false;
    }
    return true;
  }
  function threadsPostContext(node, root, parsed) {
    return visible(node) && inPostContext(node, root, parsed);
  }
  function renderedMedia(node) {
    if (visible(node)) return true;
    if (!node.matches('img[aria-hidden="true"]') || node.closest("[hidden], script, style, template") || node.parentElement?.closest('[aria-hidden="true"]')) return false;
    const view = node.ownerDocument.defaultView;
    if (!view) return false;
    for (let element = node; element; element = element.parentElement) {
      const style = view.getComputedStyle(element);
      if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility) || style.opacity === "0") return false;
    }
    const box = node.getBoundingClientRect();
    return node.getClientRects().length > 0 && box.bottom > 0 && box.right > 0 && box.top < view.innerHeight && box.left < view.innerWidth;
  }
  function threadsRoot(document2, parsed) {
    const dialogs = [...document2.querySelectorAll('[role="dialog"], dialog[open]')].filter(visible);
    if (dialogs.length > 1) throw new Error("Multiple visible dialogs prevent safe post capture.");
    const scope = dialogs[0] ?? document2.documentElement;
    const roots = [...scope.querySelectorAll(boundaries)].filter((root2) => visible(root2) && !root2.closest(excluded) && [...root2.querySelectorAll("a[href]")].some((link) => visible(link) && belongsToPost(link, root2) && !link.closest(excluded) && samePost(link.getAttribute("href"), parsed)) && ![...root2.querySelectorAll("a[href]")].some((link) => visible(link) && belongsToPost(link, root2) && !link.closest(excluded) && otherPost(link, parsed)));
    const unique = roots.filter((root2) => !roots.some((other) => other !== root2 && root2.contains(other)));
    if (unique.length > 1) throw new Error("More than one visible post matches this permalink. Open the post on its own.");
    const root = unique[0] ?? postRoot(document2, parsed);
    if (root.closest(excluded)) throw new Error("The matching Threads post is inside an excluded context.");
    for (let parent = root.parentElement; parent && parent !== scope; parent = parent.parentElement) {
      if (parent.matches(boundaries) && [...parent.querySelectorAll("a[href]")].some((link) => belongsToPost(link, parent) && otherPost(link, parsed))) {
        throw new Error("The matching Threads permalink belongs to a nested post context.");
      }
    }
    return root;
  }
  function caption(root, parsed) {
    const safe = (node) => threadsPostContext(node, root, parsed) && !node.closest('a, button, [role="button"], time, header') && !node.querySelector('time, img, video, input, textarea, button, [role="button"]') && [...node.querySelectorAll("*")].every((child) => !visible(child) || threadsPostContext(child, root, parsed)) && [...node.querySelectorAll("a")].every((link) => /^[@#]|^https?:\/\//.test(link.textContent?.trim() ?? ""));
    for (const selector of ['[data-ad-preview="message"], [data-testid="post-text"], [data-testid="post-content"]', '[dir="auto"], p, span']) {
      const candidates = [...root.querySelectorAll(selector)].filter((node) => safe(node) && Boolean(observedText(node, false, true)));
      const outer = candidates.filter((node) => !candidates.some((other) => other !== node && other.contains(node)));
      if (outer.length === 1) return observedText(outer[0], false, true);
    }
    return null;
  }
  function reference2(value) {
    try {
      return value ? validateMediaReference(value, "threads") : null;
    } catch {
      return null;
    }
  }
  function imageReference(image) {
    const variants = (image.getAttribute("srcset") ?? "").split(",").flatMap((part) => {
      const match = /^\s*(\S+)\s+(\d+(?:\.\d+)?)(w|x)\s*$/.exec(part);
      const url = match && reference2(match[1]);
      return match && url && !url.startsWith("blob:") ? [{ url, size: Number(match[2]), unit: match[3] }] : [];
    });
    const best = variants.every((variant) => variant.unit === variants[0]?.unit) ? variants.sort((a, b) => b.size - a.size)[0]?.url : null;
    return best ?? reference2(image.currentSrc) ?? reference2(image.getAttribute("src") ?? "");
  }
  function visibleMedia(root, parsed) {
    const candidates = [...root.querySelectorAll("img, video")].filter((node) => {
      if (!renderedMedia(node) || !inPostContext(node, root, parsed) || node.closest("header, h1") || /profile|avatar|foto profil|ikon|icon/i.test(node.getAttribute("alt") ?? "")) return false;
      const link = node.closest("a[href]");
      if (link && !samePost(link.getAttribute("href"), parsed)) return false;
      const box = node.getBoundingClientRect();
      if (box.width < 96 || box.height < 96) return false;
      let left = Math.max(0, box.left), top = Math.max(0, box.top);
      let right = Math.min(root.ownerDocument.defaultView.innerWidth, box.right), bottom = Math.min(root.ownerDocument.defaultView.innerHeight, box.bottom);
      for (let parent = node.parentElement; parent && root.contains(parent); parent = parent.parentElement) {
        if (parent !== root && parent.querySelectorAll("img, video").length === 1 && !parent.querySelector('[dir="auto"], [data-testid="post-text"], p, time') && [...parent.querySelectorAll("a[href]")].some((anchor) => {
          try {
            return /^\/@[A-Za-z0-9_.]+\/?$/.test(new URL(anchor.getAttribute("href"), parsed.normalizedUrl).pathname);
          } catch {
            return false;
          }
        })) return false;
        const style = root.ownerDocument.defaultView.getComputedStyle(parent);
        if (/(hidden|clip|scroll|auto)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
          const bounds = parent.getBoundingClientRect();
          left = Math.max(left, bounds.left);
          right = Math.min(right, bounds.right);
          top = Math.max(top, bounds.top);
          bottom = Math.min(bottom, bounds.bottom);
        }
        if (parent === root) break;
      }
      return Math.max(0, right - left) * Math.max(0, bottom - top) >= box.width * box.height * 0.5;
    });
    const posters = /* @__PURE__ */ new Map();
    for (const player of candidates.filter((node) => node.tagName === "VIDEO")) {
      const playerBox = player.getBoundingClientRect();
      for (let wrapper = player.parentElement; wrapper && wrapper !== root; wrapper = wrapper.parentElement) {
        if (wrapper.querySelectorAll("video").length !== 1) break;
        const covers2 = candidates.filter((node) => {
          if (node.tagName !== "IMG" || !wrapper.contains(node) || !imageReference(node)) return false;
          const box = node.getBoundingClientRect();
          const overlap = Math.max(0, Math.min(box.right, playerBox.right) - Math.max(box.left, playerBox.left)) * Math.max(0, Math.min(box.bottom, playerBox.bottom) - Math.max(box.top, playerBox.top));
          return overlap >= box.width * box.height * 0.8 && overlap >= playerBox.width * playerBox.height * 0.8;
        });
        if (covers2.length) {
          if (covers2.length === 1) posters.set(player, covers2[0]);
          break;
        }
      }
    }
    const covers = new Set(posters.values());
    const elements = candidates.filter((node) => node.tagName === "VIDEO" || !covers.has(node) && (node.getAttribute("aria-hidden") !== "true" || Boolean(node.closest("picture"))));
    const counters = [...root.querySelectorAll("[aria-label]")].filter((node) => threadsPostContext(node, root, parsed)).map((node) => /^(?:slide\s+)?(\d+)\s*(?:of|\/|dari)\s*(\d+)$/i.exec(node.getAttribute("aria-label") ?? "")).filter((match) => match !== null && Number(match[1]) > 0 && Number(match[1]) <= Number(match[2]) && Number(match[2]) <= 1e3);
    const sizes = [...new Set([...counters.map((match) => Number(match[2])), ...elements.map((node) => Number(node.closest("[aria-setsize]")?.getAttribute("aria-setsize")))].filter((size) => size > 0 && size <= 1e3))];
    const controls = [...root.querySelectorAll('button, [role="button"]')].some((node) => threadsPostContext(node, root, parsed) && /^(next|previous|berikutnya|sebelumnya|slide \d+)$/i.test(node.getAttribute("aria-label") ?? ""));
    const carousel = elements.length > 1 || controls || sizes.some((size) => size > 1);
    const totalSlides = carousel ? sizes.length === 1 ? sizes[0] : null : elements.length === 1 ? 1 : null;
    const items = elements.slice(0, 20).map((node) => {
      const video = node.tagName === "VIDEO";
      const explicit = Number(node.closest("[aria-posinset]")?.getAttribute("aria-posinset"));
      const position = explicit > 0 && explicit <= 1e3 ? explicit : counters.length === 1 && elements.length === 1 ? Number(counters[0][1]) : carousel ? null : 1;
      const player = node;
      const sources = video ? [player.currentSrc, player.getAttribute("src") ?? "", ...[...player.querySelectorAll("source")].map((source) => source.getAttribute("src") ?? "")].map(reference2).filter((url2) => Boolean(url2)) : [];
      const referenceUrl = sources.find((url2) => url2.startsWith("blob:")) ?? null;
      const url = video ? sources.find((url2) => !url2.startsWith("blob:")) ?? referenceUrl : imageReference(node);
      const cover = posters.get(player);
      return {
        position,
        type: video ? "video" : "image",
        url,
        referenceUrl,
        posterUrl: video ? reference2(player.getAttribute("poster") ?? "") ?? (cover ? imageReference(cover) : null) : null,
        width: null,
        height: null,
        assetAccess: url ? "reference_only" : "unavailable",
        processingEligibility: "unverified",
        reason: "Scoped visible Threads media reference. Variants belong to one image; bytes, absolute slide positions and remaining media are unverified unless explicitly identified."
      };
    });
    const positions = items.map((item) => item.position);
    const complete = totalSlides !== null && items.length === totalSlides && new Set(positions).size === totalSlides && positions.every((position) => position !== null && position >= 1 && position <= totalSlides) && items.every((item) => item.url);
    return { elements, media: {
      kind: carousel ? "carousel" : "single",
      totalSlides,
      items,
      navigation: "not_requested",
      completeness: complete ? "complete" : "partial",
      composition: complete ? items.some((item) => item.type === "video") ? items.some((item) => item.type === "image") ? "mixed" : "video_only" : "image_only" : "unknown",
      reason: "Threads DOM fallback preserves rendered media order. Unobserved slides and unknown absolute positions remain explicit; no slides were advanced."
    } };
  }
  function threads(document2, parsed) {
    const root = threadsRoot(document2, parsed);
    const metadata = threadsJsonPost(document2, parsed);
    const link = authorLink(root, parsed);
    const author = link && !link.closest('blockquote, [data-testid="quoted-post"], [data-testid="quote-post"]') && belongsToPost(link, root) ? link : null;
    const text = metadata.text ?? caption(root, parsed);
    const fallback = visibleMedia(root, parsed);
    const media = metadata.media ?? fallback.media;
    if (metadata.media) for (const item of media.items) {
      if (item.reason.includes("content protection")) continue;
      const match = fallback.media.items.find((candidate) => candidate.type === item.type && candidate.position === item.position && (media.kind === "single" && fallback.media.kind === "single" || media.kind === "carousel" && fallback.media.kind === "carousel" && media.totalSlides === fallback.media.totalSlides));
      if (match) {
        item.referenceUrl = match.referenceUrl;
        item.posterUrl ??= match.posterUrl;
        if (!item.url && match.url) {
          item.url = match.url;
          item.assetAccess = "reference_only";
          item.reason += " A scoped DOM reference at the same identified position is retained for verification.";
        }
      }
    }
    return {
      root,
      author,
      text,
      textReason: metadata.text !== null ? "Text from already-loaded Threads JSON matched to the exact post identity; paragraph breaks and fragment order are preserved." : text ? "Scoped visible Threads post text, preserving mentions and block formatting. Completeness is unverified; no expansion was performed." : "Matched Threads post found, but caption is unavailable or cannot be separated safely from surrounding content.",
      carousel: media.kind === "carousel",
      metadata,
      media,
      elements: fallback.elements
    };
  }

  // extension/adapters/facebook.ts
  function facebook(document2, parsed) {
    const root = postRoot(document2, parsed);
    return { root, author: authorLink(root, parsed), ...textObservation(root, '[data-ad-preview="message"]'), carousel: false };
  }

  // extension/instagram-json.ts
  function dimension2(value) {
    return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 5e4 ? Number(value) : null;
  }
  function versions2(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      try {
        const url = validateMediaReference(candidate.url, "instagram");
        if (!url.startsWith("https:")) return [];
        return [{ url, width: dimension2(candidate.width), height: dimension2(candidate.height) }];
      } catch {
        return [];
      }
    }).sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  }
  function resolvedMedia2(node) {
    const carousel = Array.isArray(node.carousel_media);
    const slides = carousel ? node.carousel_media : [node];
    if (!slides.length || slides.length > 20 || carousel && node.carousel_media_count !== void 0 && node.carousel_media_count !== slides.length) return null;
    const items = [];
    for (const [index, slide] of slides.entries()) {
      if (!isRecord(slide)) return null;
      const type = slide.media_type === 1 ? "image" : slide.media_type === 2 ? "video" : Array.isArray(slide.video_versions) && slide.video_versions.length > 0 || typeof slide.video_dash_manifest === "string" && slide.video_dash_manifest.length > 0 ? "video" : isRecord(slide.image_versions2) ? "image" : null;
      if (!type) return null;
      const image = versions2(isRecord(slide.image_versions2) ? slide.image_versions2.candidates : null)[0];
      const video = versions2(slide.video_versions)[0];
      const protectedStream = typeof slide.video_dash_manifest === "string" && /(?:\w+:)?ContentProtection\b/i.test(slide.video_dash_manifest);
      const resource = type === "image" ? image : protectedStream ? void 0 : video;
      items.push({
        position: index + 1,
        type,
        url: resource?.url ?? null,
        referenceUrl: null,
        posterUrl: type === "video" ? image?.url ?? null : null,
        width: resource?.width ?? null,
        height: resource?.height ?? null,
        assetAccess: resource ? "reference_only" : "unavailable",
        processingEligibility: "unverified",
        reason: protectedStream ? "Embedded metadata declares content protection. No protected stream was retrieved." : resource ? "Temporary CDN reference from embedded JSON matched to this post shortcode. File bytes and processing permission are unverified." : type === "video" && slide.video_dash_manifest ? "Only DASH metadata is available. Separate video/audio representations are not combined or treated as a complete MP4." : "Matched embedded slide exposes no supported media URL."
      });
    }
    return {
      discovery: "embedded_json",
      kind: carousel ? "carousel" : "single",
      totalSlides: slides.length,
      items,
      navigation: "not_requested",
      completeness: items.every((item) => item.url) ? "complete" : "partial",
      composition: items.some((item) => item.type === "video") && items.some((item) => item.type === "image") ? "mixed" : items[0].type === "video" ? "video_only" : "image_only",
      reason: "Slide order and types come from embedded JSON for the exact active shortcode. File access is evaluated separately."
    };
  }
  function instagramJsonMedia(document2, parsed) {
    if (parsed.platform !== "instagram") return null;
    let remaining = 12 * 1024 * 1024;
    let visited = 0;
    let found = null;
    for (const script of document2.querySelectorAll("script[data-sjs]")) {
      const text = script.textContent ?? "";
      remaining -= text.length;
      if (remaining < 0) return null;
      if (!text.includes(parsed.postId)) continue;
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        continue;
      }
      const stack = [json];
      while (stack.length) {
        if (++visited > 1e5) return null;
        const value = stack.pop();
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === "object") stack.push(child);
        } else if (isRecord(value)) {
          if (value.code === parsed.postId) {
            const candidate = resolvedMedia2(value);
            if (candidate) {
              if (found && JSON.stringify(found) !== JSON.stringify(candidate)) return null;
              found = candidate;
            }
            continue;
          }
          for (const child of Object.values(value)) if (child && typeof child === "object") stack.push(child);
        }
      }
    }
    return found;
  }

  // extension/capture-post.ts
  function observed(value, reason = null, media = false) {
    return { value, status: "available", source: media ? "browser_media_reference" : "browser_dom", reason, processingEligibility: "unverified", ...media ? { assetAccess: "reference_only" } : {} };
  }
  function capturePost(document2, url, now = /* @__PURE__ */ new Date()) {
    const parsed = parsePostUrl(url);
    const thread = parsed.platform === "threads" ? threads(document2, parsed) : null;
    const observation = thread ?? { instagram, threads, facebook }[parsed.platform](document2, parsed);
    const fields = emptyContentFields();
    for (const field of Object.values(fields)) field.reason = "No unambiguous value was observed in the active post DOM.";
    fields.postId = { value: parsed.postId, status: "available", source: "url", reason: null, processingEligibility: "unverified" };
    if (observation.author) {
      const author = new URL(observation.author.getAttribute("href"), parsed.normalizedUrl);
      if (parsed.platform === "instagram") author.pathname = author.pathname.replace(/\/reels\/?$/, "/");
      author.search = "";
      author.hash = "";
      fields.authorUrl = observed(author.href);
      fields.authorHandle = observed(author.pathname.replace(/^\/@?/, "").replace(/\/$/, ""));
    }
    if (thread?.metadata.username) {
      fields.authorHandle = observed(thread.metadata.username, "Author username from already-loaded Threads metadata matched to the exact post.");
      fields.authorUrl = observed(new URL(`/@${thread.metadata.username}`, parsed.normalizedUrl).href, "Profile URL for the username in the matched Threads metadata.");
    }
    const collaborators = collaborationLinks(observation.root, parsed);
    if (collaborators.length) {
      fields.collaboratorHandles = observed(collaborators.map((link) => new URL(link.getAttribute("href"), parsed.normalizedUrl).pathname.replace(/^\//, "").replace(/\/$/, "")), "Accounts explicitly listed together in the visible collaboration header. Ordering does not establish ownership.");
      fields.authorHandle.reason = fields.authorUrl.reason = "First account in the observed collaboration header; not a claim of sole authorship or ownership.";
    }
    const textKey = parsed.platform === "instagram" ? "captionText" : "textContent";
    fields[textKey].reason = observation.textReason;
    if (observation.text) fields[textKey] = observed(observation.text, observation.textReason);
    if (parsed.platform === "instagram") {
      const inHeader = (node) => {
        const authorPath = observation.author?.getAttribute("href");
        if (!authorPath) return false;
        for (let parent = node.parentElement, depth = 0; parent && observation.root.contains(parent) && depth < 18; parent = parent.parentElement, depth++) {
          if (parent.querySelector('time, textarea, [contenteditable="true"], a[href*="/c/"]')) return false;
          if ([...parent.querySelectorAll("a[href]")].some((link) => link.getAttribute("href") === authorPath)) return true;
        }
        return false;
      };
      const postLinks2 = [...observation.root.querySelectorAll("a[href]")].filter((link) => instagramPostContext(link, observation.root, parsed));
      for (const [key, pattern] of [["location", /^\/explore\/locations\/\d+(?:\/[^/]+)?\/?$/], ["audioLabel", /^\/(?:reels\/audio|music)\/\d+\/?$/]]) {
        const contextLinks = key === "audioLabel" ? postLinks2 : postLinks2.filter(inHeader);
        const labels = [...new Set(contextLinks.filter((link) => {
          const target = new URL(link.getAttribute("href"), parsed.normalizedUrl);
          return target.origin === new URL(parsed.normalizedUrl).origin && pattern.test(target.pathname);
        }).map((node) => observedText(node, true)).filter((text) => Boolean(text)))];
        if (labels.length === 1) {
          const attribution = key === "audioLabel" ? contextLinks.find((link) => observedText(link, true) === labels[0] && pattern.test(new URL(link.getAttribute("href"), parsed.normalizedUrl).pathname)) : null;
          fields[key] = observed(labels[0], key === "audioLabel" ? `Visible audio attribution label only; no audio file was retrieved.${attribution ? ` Link: ${new URL(attribution.getAttribute("href"), parsed.normalizedUrl).origin}${new URL(attribution.getAttribute("href"), parsed.normalizedUrl).pathname}` : ""}` : "Visible location link label within the matched post; not coordinates or inferred location.");
        }
      }
      if (!fields.audioLabel.value) {
        const labels = [...new Set(instagramAudioControls(observation.root, parsed).map((node) => observedText(node, true)).filter((label) => Boolean(label)))];
        if (labels.length === 1) fields.audioLabel = observed(labels[0], "Visible text beside an explicit audio/music control in the matched post; no audio file was retrieved.");
      }
      if (!fields.audioLabel.value) {
        const labels = [...new Set([...observation.root.querySelectorAll("span")].filter((node) => visible(node) && belongsToPost(node, observation.root) && !node.querySelector("span") && /^(Original audio|Audio asli)$/i.test(node.textContent?.trim() ?? "") && inHeader(node)).map((node) => observedText(node, true)).filter(Boolean))];
        if (labels.length === 1) fields.audioLabel = observed(labels[0], "Visible original-audio label in the author header; no creator identity or audio file is inferred.");
      }
    }
    const warnings = thread ? ["Capture reads the matched Threads post after a user click, including already-loaded script[data-sjs] JSON matched to its exact identity. Scripts are never executed.", ...thread.metadata.warnings] : ["Capture reads the matched post DOM after a user click. Instagram media may also use already-loaded script[data-sjs] JSON matched to the exact shortcode; scripts are never executed."];
    const excluded2 = (element) => !isPostMedia(element, observation.root, parsed) || Boolean(thread && !threadsPostContext(element, observation.root, parsed));
    const elements = thread?.elements ?? mediaElements(observation.root, parsed);
    const images = elements.filter((node) => node.tagName === "IMG");
    const videos = elements.filter((node) => node.tagName === "VIDEO");
    const embedded = instagramJsonMedia(document2, parsed);
    const visibleMedia2 = thread?.media ?? readMedia(observation.root, parsed, observation.carousel);
    if (embedded) for (const item of embedded.items) {
      const fallback = visibleMedia2.kind === embedded.kind ? visibleMedia2.items.find((visible3) => visible3.position === item.position && visible3.type === item.type) : void 0;
      if (fallback && !item.reason.includes("content protection")) {
        item.referenceUrl = fallback.referenceUrl;
        if (!item.url && fallback.url) {
          item.url = fallback.url;
          item.assetAccess = "reference_only";
          item.reason += " The matching visible player reference is retained without assuming reusable bytes.";
        }
        item.posterUrl ??= fallback.posterUrl;
      }
    }
    const media = embedded ?? visibleMedia2;
    if (embedded) warnings.push("Embedded media URLs are temporary CDN references. Verification uses anonymous CORS GET only; access and AI processing permission remain separate.");
    else if (thread?.media.discovery === "embedded_json") warnings.push("Threads embedded media URLs are temporary CDN references. Verification uses anonymous CORS GET only; access and AI processing permission remain separate.");
    else if (parsed.platform === "instagram") warnings.push("No unambiguous supported embedded media matched the active shortcode. Visible media references are retained; blob players and DASH streams are not reusable files.");
    const references = (values) => [...new Set(values.filter(Boolean).filter((value) => {
      try {
        validateMediaReference(value, parsed.platform);
        return true;
      } catch {
        warnings.push("An unsupported or credential-like media reference was omitted. No media was fetched.");
        return false;
      }
    }))];
    const audio = [...observation.root.querySelectorAll("audio")].filter((node) => visible(node) && !excluded2(node));
    const audioUrls = references(audio.map((node) => node.currentSrc || node.getAttribute("src") || ""));
    if (audioUrls.length === 1) fields.audioUrl = observed(audioUrls[0], "Reference only; independent audio access and format are unverified.", true);
    if (thread) {
      if (media.kind === "carousel" || media.items.length === 1) fields.mediaType = observed(media.kind === "carousel" ? "carousel" : media.items[0].type, media.reason);
      else if (observation.text) fields.mediaType = observed("text", "Matched Threads post text was captured. No supported media was identified; additional or unavailable media are unknown.");
    } else if (embedded) {
      fields.mediaType = observed(embedded.kind === "carousel" ? "carousel" : embedded.items[0].type, embedded.reason);
    } else if (observation.carousel) {
      fields.mediaType = observed("carousel", "Carousel controls were observed. Only visible elements were captured; total slides are unknown.");
      warnings.push("Carousel capture is partial. No slides were advanced, and remaining media are unknown.");
    } else if (videos.length) fields.mediaType = observed("video", "A visible video element was observed. File accessibility is not established.");
    else if (images.length) fields.mediaType = observed("image", "Visible image elements were observed. This does not establish whether the post has additional slides.");
    else if (observation.text && parsed.platform !== "instagram") fields.mediaType = observed("text", "Visible post text was captured; additional media outside the visible context are unknown.");
    const times = [...observation.root.querySelectorAll("a[href]")].filter((link) => samePost(link.getAttribute("href"), parsed) && (!thread || threadsPostContext(link, observation.root, parsed))).flatMap((link) => [...link.querySelectorAll("time[datetime]")]).filter(visible);
    const dates = [...new Set(times.map((node) => node.dateTime))];
    if (dates.length === 1 && Number.isFinite(Date.parse(dates[0]))) fields.publishedAt = observed(dates[0], "Timestamp observed on the matching post permalink.");
    return normalizeCapture({ version: 1, inspection: {
      media,
      inspectionMethod: "extension",
      platform: parsed.platform,
      normalizedUrl: parsed.normalizedUrl,
      inspectedAt: now.toISOString(),
      fields,
      warnings: [...new Set(warnings)]
    } });
  }
  async function captureWithRetry(document2, expectedUrl, dependencies = {}) {
    const getUrl = dependencies.getUrl ?? (() => document2.location.href);
    const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const read = dependencies.read ?? capturePost;
    let last;
    let failure;
    const deadline = Date.now() + 3e3;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (Date.now() > deadline) break;
      if (getUrl() !== expectedUrl) throw new Error("The tab navigated during capture. Open the desired post and capture again.");
      try {
        last = read(document2, expectedUrl);
        if (getUrl() !== expectedUrl) throw new Error("The tab navigated during capture.");
        if (last.inspection.fields.captionText.value || last.inspection.fields.textContent.value) return last;
      } catch (error) {
        failure = error;
      }
      if (attempt < 2) await sleep(750);
    }
    if (getUrl() !== expectedUrl) throw new Error("The tab navigated during capture. Capture discarded.");
    if (last) return last;
    throw failure instanceof Error ? failure : new Error("No supported visible post was found.");
  }

  // src/lib/capture/media-resource.ts
  async function readResourceBytes(response, maximum) {
    const length = response.headers.get("content-length");
    const declared = length === null ? null : Number(length);
    if (declared !== null && (!Number.isSafeInteger(declared) || declared <= 0 || declared > maximum)) {
      await response.body?.cancel();
      throw new Error("Invalid or excessive media Content-Length.");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Media response has no readable bytes.");
    const parts = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > maximum) {
          await reader.cancel();
          throw new Error("Media exceeds its byte limit.");
        }
        parts.push(new Uint8Array(value));
      }
    } finally {
      reader.releaseLock();
    }
    if (!size || declared !== null && declared !== size) throw new Error("Empty or truncated media response.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }

  // extension/verify-media.ts
  async function verifyMedia(media, dependencies = {}) {
    const result = structuredClone(media);
    const deadline = Date.now() + 15e3;
    for (const [itemIndex, item] of result.items.entries()) {
      delete item.verification;
      if (!item.url) {
        item.assetAccess = "unavailable";
        continue;
      }
      if (item.url.startsWith("blob:")) {
        item.assetAccess = "reference_only";
        continue;
      }
      item.assetAccess = "reference_only";
      if (Date.now() >= deadline) {
        item.reason = "Media verification time budget was exhausted. The temporary URL remains reference_only.";
        continue;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(item.type === "video" ? 7500 : 2500, deadline - Date.now()));
      try {
        validateMediaReference(item.url, "instagram");
        const response = await (dependencies.transport ?? fetch)(item.url, { method: "GET", mode: "cors", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal });
        if (!response.ok || response.type === "opaque" || response.redirected) {
          await response.body?.cancel();
          if (item.type === "image" && [403, 404, 410].includes(response.status)) item.assetAccess = "unavailable";
          item.reason = `Resource verification returned HTTP ${response.status}. This does not establish post privacy or deletion.`;
          continue;
        }
        const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (item.type === "video") {
          if (response.status !== 200 || mimeType !== "video/mp4" || response.headers.has("content-range")) {
            await response.body?.cancel();
            throw new Error("A complete video/mp4 response is required; partial/DASH streams are not accepted.");
          }
          const bytes = await readResourceBytes(response, MAX_VIDEO_BYTES);
          const metadata = inspectMp4(bytes);
          const decoded = await (dependencies.decodeVideo ?? decodeMp4)(new Blob([bytes], { type: mimeType }), controller.signal);
          if (Math.abs(decoded.duration - metadata.durationSeconds) > Math.max(0.25, metadata.durationSeconds * 0.01)) throw new Error("MP4 decoded duration does not match sample timing.");
          item.width = decoded.width;
          item.height = decoded.height;
          item.verification = {
            method: "cors_get",
            mimeType,
            byteLength: bytes.length,
            checkedAt: (dependencies.now ?? (() => /* @__PURE__ */ new Date()))().toISOString(),
            durationSeconds: metadata.durationSeconds,
            audio: metadata.audio,
            sha256: await mediaDigest(bytes)
          };
          item.assetAccess = "verified_accessible";
          dependencies.onVerified?.(itemIndex, bytes, mimeType);
          item.reason = `Anonymous CORS GET returned a complete MP4 within 25 MiB. Sample ranges/timing and first-frame decoding were checked; audio track ${metadata.audio}. CDN access is temporary and AI permission remains unverified.`;
          continue;
        }
        const maximum = 10 * 1024 * 1024;
        if (!["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(mimeType) || Number(response.headers.get("content-length")) > maximum) {
          await response.body?.cancel();
          if (!mimeType.startsWith("image/")) item.assetAccess = "unavailable";
          item.reason = "Unsupported MIME type or image exceeds the 10 MiB verification limit.";
          continue;
        }
        const reader = response.body?.getReader();
        if (!reader) continue;
        const parts = [];
        let size = 0;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > maximum) {
              await reader.cancel();
              throw new Error("Image size limit.");
            }
            parts.push(new Uint8Array(value));
          }
        } finally {
          reader.releaseLock();
        }
        const blob = new Blob(parts, { type: mimeType });
        const image = await (dependencies.decode ?? createImageBitmap)(blob);
        try {
          if (image.width <= 0 || image.height <= 0) throw new Error("Image could not be decoded.");
          item.width = image.width;
          item.height = image.height;
          item.assetAccess = "verified_accessible";
          item.verification = { method: "cors_get", mimeType, byteLength: size, checkedAt: (dependencies.now ?? (() => /* @__PURE__ */ new Date()))().toISOString() };
          if (dependencies.onVerified) dependencies.onVerified(itemIndex, new Uint8Array(await blob.arrayBuffer()), mimeType);
          item.reason = "Anonymous CORS GET returned a supported image MIME type and readable, decoded image bytes. Access is observed at capture time; AI permission remains unverified.";
        } finally {
          image.close();
        }
      } catch (error) {
        item.assetAccess = "reference_only";
        delete item.verification;
        item.reason = item.type === "video" ? `MP4 verification failed: ${error instanceof Error ? error.message.slice(0, 300) : "CORS, network, decoding, or time limit."} The temporary URL remains reference_only; audio and processing permission are not assumed.` : "Independent image verification could not finish (CORS, network, decoding, or time limit). The observed URL remains a reference only.";
      } finally {
        clearTimeout(timer);
      }
    }
    return result;
  }

  // extension/capture-carousel.ts
  async function captureCarousel(document2, url, allSlides, dependencies = {}) {
    const parsed = parsePostUrl(url);
    const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const getUrl = dependencies.getUrl ?? (() => document2.location.href);
    const initial = await (dependencies.capture ?? captureWithRetry)(document2, url);
    if (!initial.inspection.media) return initial;
    let media = initial.inspection.media;
    const byPosition = /* @__PURE__ */ new Map();
    let interrupted = false;
    const stop = (event) => {
      if (event.isTrusted) interrupted = true;
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((event) => document2.addEventListener(event, stop, true));
    const deadline = Date.now() + 3e4;
    const guard = () => {
      if (!samePost(getUrl(), parsed)) throw new Error("The tab navigated to another post. Capture discarded.");
      if (interrupted || document2.visibilityState === "hidden" || Date.now() >= deadline) throw new Error("Carousel navigation stopped after interaction, tab hiding, or time limit.");
    };
    const read = () => {
      guard();
      const root = postRoot(document2, parsed);
      const next = readMedia(root, parsed, true);
      for (const item of next.items) if (item.position !== null) byPosition.set(item.position, item);
      return { root, media: next };
    };
    try {
      if (allSlides && parsed.platform === "instagram" && media.discovery !== "embedded_json" && media.kind === "carousel" && media.completeness !== "complete") {
        media.navigation = "stopped";
        let current = read();
        const position = () => current.media.items.length === 1 ? current.media.items[0].position : null;
        const move = async (direction) => {
          guard();
          const before = position();
          if (current.media.items.length !== 1) throw new Error("Active slide media is ambiguous.");
          const signature = JSON.stringify(current.media.items.map((item) => [item.type, item.url]));
          const button = carouselControl(current.root, direction);
          if (!button) throw new Error("No unique safe carousel control was found.");
          button.click();
          for (let attempt = 0; attempt < 6; attempt++) {
            await sleep(200);
            current = read();
            const after = position();
            const advanced = before !== null && after !== null ? after === before + (direction === "next" ? 1 : -1) : JSON.stringify(current.media.items.map((item) => [item.type, item.url])) !== signature;
            if (current.media.items.length === 1 && advanced && current.media.items.every((item) => item.url)) return;
          }
          throw new Error("The slide did not load or advance to the expected position.");
        };
        let total = current.media.totalSlides;
        if (total !== null && total > 20) throw new Error("Carousel exceeds the 20-slide navigation limit.");
        if (current.media.items.length !== 1) throw new Error("The active media region is ambiguous.");
        if (total !== null && position() !== null) {
          while (position() > 1) await move("previous");
          while (position() < total) await move("next");
        } else {
          let steps = 0;
          if (!carouselControl(current.root, "previous") && !carouselControl(current.root, "next")) throw new Error("No safe carousel navigation controls were found.");
          while (carouselControl(current.root, "previous")) {
            if (++steps >= 20) throw new Error("Could not find the first slide within the navigation limit.");
            await move("previous");
          }
          byPosition.clear();
          let index = 1;
          const collect = () => byPosition.set(index, { ...current.media.items[0], position: index });
          collect();
          while (carouselControl(current.root, "next")) {
            if (index >= 20) throw new Error("Stopped at the 20-slide navigation limit; remaining slides are unknown.");
            await move("next");
            index++;
            collect();
          }
          total = index;
        }
        media.items = [...byPosition.values()].sort((a, b) => a.position - b.position);
        media.totalSlides = total;
        media.completeness = media.items.length === total && media.items.every((item) => item.url) ? "complete" : "partial";
        media.navigation = "completed";
        media.reason = media.completeness === "complete" ? "Visited every slide through visible carousel controls, from the first identified slide to the last observed endpoint." : "Some slide positions or media resources were not observed.";
      }
    } catch (error) {
      if (!samePost(getUrl(), parsed)) throw new Error("The tab navigated to another post. Capture discarded.");
      if (byPosition.size) media.items = [...byPosition.values()].sort((a, b) => a.position - b.position);
      media.completeness = "partial";
      media.navigation = "stopped";
      media.reason = error instanceof Error ? error.message : "Safe carousel navigation stopped.";
    } finally {
      events.forEach((event) => document2.removeEventListener(event, stop, true));
    }
    if (!samePost(getUrl(), parsed)) throw new Error("The tab navigated to another post. Capture discarded.");
    media = await (dependencies.verify ?? verifyMedia)(media, { onVerified: dependencies.onVerified });
    if (!samePost(getUrl(), parsed)) throw new Error("The tab navigated during media verification. Capture discarded.");
    const warnings = initial.inspection.warnings.filter((warning) => !warning.startsWith("Carousel capture is partial."));
    if (media.completeness !== "complete") warnings.push("Carousel/media capture is incomplete. See media.reason and the observed slide positions.");
    return normalizeCapture({ ...initial, inspection: { ...initial.inspection, media, warnings } });
  }

  // extension/snapshot-region.ts
  function snapshotCandidate(document2, url) {
    const parsed = parsePostUrl(url);
    const root = postRoot(document2, parsed);
    const elements = [...document2.querySelectorAll("img, video")];
    const allMedia = mediaElements(root, parsed);
    const videos = allMedia.filter((node2) => node2.tagName === "VIDEO");
    const media = videos.length ? videos : allMedia;
    if (media.length !== 1) return null;
    const node = media[0];
    const view = document2.defaultView;
    const box = node.getBoundingClientRect();
    const x = Math.max(0, box.left), y = Math.max(0, box.top);
    const region = validateRegion({
      x,
      y,
      width: Math.min(view.innerWidth, box.right) - x,
      height: Math.min(view.innerHeight, box.bottom) - y,
      viewportWidth: view.innerWidth,
      viewportHeight: view.innerHeight,
      scrollX: view.scrollX,
      scrollY: view.scrollY
    });
    const mediaSource = node.currentSrc || node.getAttribute("src") || "";
    if (!mediaSource || mediaSource.length > 4096) return null;
    if (typeof document2.elementsFromPoint === "function") {
      let parent = node.parentElement;
      for (let next = parent?.parentElement, depth = 0; next && depth < 8; next = next.parentElement, depth++) {
        const bounds = next.getBoundingClientRect();
        if ([bounds.left - box.left, bounds.top - box.top, bounds.width - box.width, bounds.height - box.height].some((delta) => Math.abs(delta) > 2)) break;
        parent = next;
      }
      for (const [px, py] of [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]]) {
        const top = document2.elementsFromPoint(x + region.width * px, y + region.height * py)[0];
        if (!top || !parent?.contains(top)) return null;
      }
    }
    return { region, mediaIndex: elements.indexOf(node), mediaSource };
  }

  // src/lib/capture/media-cache.ts
  var MAX_HANDOFF_MEDIA_BYTES = 50 * 1024 * 1024;
  var MEDIA_CHUNK_BYTES = 512 * 1024;

  // extension/capture.ts
  var isolated = globalThis;
  var request = isolated.__memoarCaptureRequest;
  delete isolated.__memoarCaptureRequest;
  if (request) {
    if (isolated.__memoarCapturedMedia) isolated.__memoarCapturedMedia.assets.length = 0;
    const retained = { nonce: request.nonce, expiresAt: Date.now() + CAPTURE_TTL_MS, assets: [] };
    isolated.__memoarCapturedMedia = retained;
    const expire = setTimeout(() => {
      if (isolated.__memoarCapturedMedia === retained) delete isolated.__memoarCapturedMedia;
      retained.assets.length = 0;
    }, CAPTURE_TTL_MS);
    let size = 0;
    void captureCarousel(document, request.url, request.allSlides, { onVerified: (itemIndex, bytes, mimeType) => {
      if (size + bytes.length > MAX_HANDOFF_MEDIA_BYTES) throw new Error("Captured media exceeds the 50 MiB handoff limit.");
      size += bytes.length;
      retained.assets.push({ itemIndex, mimeType, byteLength: bytes.length, bytes });
    } }).then(
      (payload) => {
        let candidate = null;
        try {
          candidate = snapshotCandidate(document, request.url);
        } catch {
        }
        return chrome.runtime.sendMessage({
          type: "CAPTURE_RESULT",
          nonce: request.nonce,
          payload,
          candidate,
          mediaAssets: retained.assets.map(({ itemIndex, mimeType, byteLength }) => ({ itemIndex, mimeType, byteLength }))
        });
      },
      (error) => {
        clearTimeout(expire);
        retained.assets.length = 0;
        if (isolated.__memoarCapturedMedia === retained) delete isolated.__memoarCapturedMedia;
        return chrome.runtime.sendMessage({ type: "CAPTURE_ERROR", nonce: request.nonce, message: error instanceof Error ? error.message : "Capture failed." });
      }
    );
  }
})();
