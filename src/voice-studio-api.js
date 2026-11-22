const DEFAULT_MODEL = "voxcpm2";
const MAX_INPUT_CHARS = 4096;
const GENERATION_TIMEOUT_MS = 300000;

function isLoopback(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export function getVoiceStudioConfig(env = process.env) {
  const rawBaseUrl = String(env.VOICE_STUDIO_BASE_URL || "").trim();
  if (!rawBaseUrl) {
    return { configured: false, reason: "VOICE_STUDIO_BASE_URL is not configured." };
  }

  let parsed;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    return { configured: false, reason: "VOICE_STUDIO_BASE_URL must be a valid URL." };
  }

  if (!["http:", "https:"].includes(parsed.protocol) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { configured: false, reason: "VoiceStudio URL must use HTTP(S) and must not contain credentials, query parameters or a fragment." };
  }

  const local = isLoopback(parsed.hostname);
  if (!local && parsed.protocol !== "https:") {
    return { configured: false, reason: "Remote VoiceStudio connections must use HTTPS to protect the API key." };
  }
  const apiKey = String(env.VOICE_STUDIO_API_KEY || "").trim();
  if (!local && !apiKey) {
    return { configured: false, reason: "Set VOICE_STUDIO_API_KEY for a remote VoiceStudio server." };
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");
  if (!basePath.endsWith("/v1")) parsed.pathname = (basePath || "") + "/v1";
  else parsed.pathname = basePath;
  parsed.search = "";
  parsed.hash = "";

  const model = String(env.VOICE_STUDIO_MODEL || DEFAULT_MODEL).trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(model)) {
    return { configured: false, reason: "VOICE_STUDIO_MODEL contains unsupported characters." };
  }

  return {
    configured: true,
    baseUrl: parsed.toString().replace(/\/+$/, ""),
    apiKey,
    model,
    local
  };
}

function endpointUrl(config, path) {
  return config.baseUrl + "/" + String(path || "").replace(/^\/+/, "");
}

async function voiceStudioRequest(config, path, options = {}, fetchImpl = fetch) {
  const headers = new Headers(options.headers || {});
  if (config.apiKey) headers.set("Authorization", "Bearer " + config.apiKey);
  const response = await fetchImpl(endpointUrl(config, path), {
    ...options,
    headers,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 20000)
  });
  if (!response.ok) {
    const payload = await response.json().catch(async () => ({ detail: await response.text().catch(() => "") }));
    const message = payload?.error?.message || payload?.detail || payload?.message ||
      "VoiceStudio API returned HTTP " + response.status + ".";
    const error = new Error(String(message).slice(0, 500));
    error.status = response.status === 401 || response.status === 403 ? 502
      : response.status === 429 ? 429
      : response.status >= 500 ? 502
      : response.status;
    throw error;
  }
  return response;
}

export function inspectWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 ||
      buffer.toString("ascii", 0, 4) !== "RIFF" ||
      buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("VoiceStudio returned an invalid WAV audio file.");
  }

  let offset = 12;
  let format = null;
  let dataBytes = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) throw new Error("VoiceStudio returned a truncated WAV file.");
    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("VoiceStudio returned an unsupported WAV format.");
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkEnd + (chunkSize & 1);
  }

  if (!format || !dataBytes || !format.byteRate || !format.sampleRate || !format.channels) {
    throw new Error("VoiceStudio WAV is missing valid audio format or data.");
  }
  if (![1, 3, 65534].includes(format.audioFormat)) {
    throw new Error("VoiceStudio returned an unsupported WAV encoding.");
  }
  return {
    ...format,
    dataBytes,
    durationSec: dataBytes / format.byteRate
  };
}

export async function getVoiceStudioStatus({ env = process.env, fetchImpl = fetch } = {}) {
  const config = getVoiceStudioConfig(env);
  if (!config.configured) {
    return {
      configured: false,
      available: false,
      model: String(env.VOICE_STUDIO_MODEL || DEFAULT_MODEL),
      modelAvailable: false,
      profileCount: 0,
      message: config.reason
    };
  }

  try {
    const [modelsResponse, voicesResponse] = await Promise.all([
      voiceStudioRequest(config, "models", {}, fetchImpl),
      voiceStudioRequest(config, "audio/voices", {}, fetchImpl)
    ]);
    const modelsPayload = await modelsResponse.json();
    const voicesPayload = await voicesResponse.json();
    const modelEntries = Array.isArray(modelsPayload?.data) ? modelsPayload.data : [];
    const modelAvailable = modelEntries.some(item => item?.id === config.model);
    const profiles = Array.isArray(voicesPayload?.voices)
      ? voicesPayload.voices.filter(item => item?.type === "profile")
      : [];
    return {
      configured: true,
      available: true,
      model: config.model,
      modelAvailable,
      profileCount: profiles.length,
      message: modelAvailable
        ? "VoiceStudio connected."
        : "VoiceStudio connected, but model " + config.model + " is not installed or available."
    };
  } catch (error) {
    return {
      configured: true,
      available: false,
      model: config.model,
      modelAvailable: false,
      profileCount: 0,
      message: error.message || "VoiceStudio could not be reached."
    };
  }
}

export async function listVoiceStudioProfiles({ env = process.env, fetchImpl = fetch } = {}) {
  const config = getVoiceStudioConfig(env);
  if (!config.configured) {
    const error = new Error(config.reason);
    error.status = 503;
    throw error;
  }

  const response = await voiceStudioRequest(config, "audio/voices", {}, fetchImpl);
  const payload = await response.json();
  const voices = Array.isArray(payload?.voices) ? payload.voices : [];
  return voices
    .filter(item => item?.type === "profile" && typeof item.voice_id === "string" && typeof item.name === "string")
    .map(item => ({
      id: item.voice_id,
      name: item.name,
      language: typeof item.language === "string" ? item.language : "",
      addressableByName: item.addressable_by_name === true
    }));
}

export async function generateVoiceStudioSpeech({
  text,
  voiceId,
  instructions = "",
  env = process.env,
  fetchImpl = fetch
} = {}) {
  const config = getVoiceStudioConfig(env);
  if (!config.configured) {
    const error = new Error(config.reason);
    error.status = 503;
    throw error;
  }

  const input = String(text || "").trim();
  const profileId = String(voiceId || "").trim();
  const style = String(instructions || "").trim().slice(0, 1500);
  if (!input) {
    const error = new Error("Hindi narration खाली है।");
    error.status = 400;
    throw error;
  }
  if (input.length > MAX_INPUT_CHARS) {
    const error = new Error("VoiceStudio API की एक request में अधिकतम 4,096 characters भेजे जा सकते हैं। Script छोटा करें।");
    error.status = 400;
    throw error;
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profileId)) {
    const error = new Error("अपनी cloned voice के लिए VoiceStudio Profile चुनें।");
    error.status = 400;
    throw error;
  }

  const response = await voiceStudioRequest(config, "audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      input,
      voice: profileId,
      language: "hi",
      instructions: style || "Speak natural Indian Hindi with clear pronunciation and a natural, expressive delivery. Preserve the cloned speaker's voice identity. Do not translate, omit, or add words.",
      response_format: "wav",
      speed: 1
    }),
    timeoutMs: GENERATION_TIMEOUT_MS,
    signal: AbortSignal.timeout(GENERATION_TIMEOUT_MS)
  }, fetchImpl);

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 40 * 1024 * 1024) {
    const error = new Error("VoiceStudio audio response is larger than the 40 MB safety limit.");
    error.status = 502;
    throw error;
  }
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length > 40 * 1024 * 1024) {
    const error = new Error("VoiceStudio audio response is larger than the 40 MB safety limit.");
    error.status = 502;
    throw error;
  }
  const wav = inspectWav(audio);
  return {
    buffer: audio,
    mimeType: "audio/wav",
    durationSec: wav.durationSec,
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    bitsPerSample: wav.bitsPerSample,
    model: config.model
  };
}

export const VOICE_STUDIO_MAX_INPUT_CHARS = MAX_INPUT_CHARS;
