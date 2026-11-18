const SUPPORTED_SERVICES = new Set(["facebook", "instagram", "youtube"]);

function isNonPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain", "::1", "0.0.0.0"].includes(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;

  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
  }

  return host.startsWith("fc") || host.startsWith("fd") ||
    host.startsWith("fe80:") || host.startsWith("ff");
}

export function buildBufferVideoPostInput({
  channel,
  videoUrl,
  platformCopy,
  isAiGenerated = true
}) {
  if (!channel || typeof channel.id !== "string" || !channel.id.trim()) {
    throw new Error("A valid Buffer channel is required.");
  }

  const service = String(channel.service || "").toLowerCase();
  if (!SUPPORTED_SERVICES.has(service)) {
    throw new Error("Only Facebook, Instagram and YouTube channels are supported.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(String(videoUrl || ""));
  } catch {
    throw new Error("Video URL must be a valid public HTTPS URL.");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
    throw new Error("Video URL must be a public HTTPS URL without login credentials.");
  }
  if (isNonPublicHost(parsedUrl.hostname)) {
    throw new Error("Private or local video URLs cannot be fetched by Buffer. Use a public video URL.");
  }

  const copy = platformCopy && typeof platformCopy === "object" ? platformCopy : {};
  const assets = [{ video: { url: parsedUrl.toString() } }];
  const input = {
    channelId: channel.id,
    schedulingType: "automatic",
    mode: "addToQueue",
    assets,
    aiAssisted: true
  };

  if (service === "facebook") {
    input.text = String(copy.facebookCaption || "").trim();
    input.metadata = { facebook: { type: "reel" } };
  } else if (service === "instagram") {
    input.text = String(copy.instagramCaption || "").trim();
    input.metadata = {
      instagram: {
        type: "reel",
        shouldShareToFeed: true,
        isAiGenerated: Boolean(isAiGenerated)
      }
    };
  } else {
    input.text = String(copy.youtubeDescription || "").trim();
    const title = String(copy.youtubeTitle || "").trim();
    if (!title) throw new Error("YouTube Shorts title is required.");
    if (title.length > 100) throw new Error("YouTube title must be 100 characters or fewer.");
    input.metadata = {
      youtube: {
        title,
        categoryId: "27",
        privacy: "public",
        notifySubscribers: true,
        madeForKids: false,
        isAiGenerated: Boolean(isAiGenerated)
      }
    };
  }

  if (!input.text) throw new Error("The selected platform caption or description is empty.");
  return input;
}
