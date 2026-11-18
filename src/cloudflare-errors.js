function extractCloudflareError(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const first = errors[0] || payload?.error || {};
  const code = first?.code ?? payload?.code ?? null;
  const message = [
    ...errors.map(item => item?.message),
    payload?.error?.message,
    payload?.message
  ].find(value => typeof value === "string" && value.trim()) || "";
  return { code: code === null ? null : String(code), message: message.trim() };
}

export function classifyCloudflareImageError({
  httpStatus,
  payload = {},
  retryAfterHeader = null
} = {}) {
  const { code, message: providerMessage } = extractCloudflareError(payload);
  const normalized = providerMessage.toLowerCase();
  const isDailyQuota =
    code === "3036" ||
    code === "4006" ||
    /daily free allocation|used up.*10,000 neurons|10,000 neurons.*(used|exceed|allocation)/i.test(providerMessage);
  const isCapacity =
    code === "3040" ||
    /capacity temporarily exceeded|out of capacity|no more data centers/i.test(providerMessage);

  let message;
  if (isDailyQuota) {
    message = "Cloudflare Workers AI की 10,000 Neurons वाली daily free allocation पूरी हो गई है। Cloudflare Dashboard में usage जाँचें; allocation उपलब्ध होने पर ही image generation फिर चलाएँ। कोई paid fallback नहीं होगा।";
  } else if (isCapacity) {
    message = "Cloudflare Workers AI में इस समय model capacity उपलब्ध नहीं है (temporary 3040)। थोड़ी देर बाद केवल एक बार फिर कोशिश करें। बार-बार retry न करें।";
  } else if (Number(httpStatus) === 429) {
    message = providerMessage
      ? "Cloudflare ने request पर rate limit लगाई (HTTP 429): " + providerMessage
      : "Cloudflare ने request पर HTTP 429 rate limit लगाई। थोड़ी देर बाद retry करें; अभी paid fallback नहीं होगा।";
  } else {
    message = providerMessage || "Cloudflare Workers AI image request failed (HTTP " + httpStatus + ").";
  }

  const parsedRetryAfter = retryAfterHeader === null || retryAfterHeader === undefined
    ? null
    : Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0
    ? parsedRetryAfter
    : null;

  return {
    status: Number(httpStatus) === 429 ? 429 : Number(httpStatus) >= 500 ? 502 : Number(httpStatus || 502),
    code,
    message,
    retryAfterSeconds
  };
}
