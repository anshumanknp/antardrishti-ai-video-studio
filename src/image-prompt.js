export const CLOUDFLARE_IMAGE_PROMPT_LIMIT = 1900;

const FIXED_IMAGE_INSTRUCTIONS = [
  "Create a premium cinematic square still for a vertical 9:16 Hindi self-awareness video.",
  "INDIAN CONTEXT: Use natural-looking Indian people and authentic contemporary Indian settings when relevant. Avoid Western stock-photo styling and stereotypes.",
  "ABSTRACT RULE: For an abstract, symbol, graphic or object-only direction, show only that; no person or unrelated portrait.",
  "STYLE: Cinematic, natural light, restrained navy and warm neutrals; follow any explicitly requested art treatment.",
  "COMPOSITION: Square for centered 9:16 crop; keep key subject in central 55% width, match framing, and leave lower-center caption area calm.",
  "NO TEXT: No writing, letters, numbers, signs, labels, captions, logos, watermarks, UI or borders.",
  "AVOID: Scene labels/numbers, medical or hospital imagery, distressed patients, diagnostic symbols, supernatural claims and frightening imagery.",
  "One coherent image only; no collage, storyboard, split panel, contact sheet or poster."
].join("\n");

function cleanPromptText(value, fallback = "") {
  const text = typeof value === "string" ? value : fallback;
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function truncatePromptText(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join("").trimEnd();
}

export function buildCloudflareScenePrompt({
  topic = "",
  dialogueContext = "",
  visualDirection = "",
  shotType = "medium shot",
  cameraMovement = "gentle push-in"
} = {}) {
  const fields = [
    { label: "Exact visual direction", value: cleanPromptText(visualDirection, "Create a calm, reflective scene matching the video topic."), maxLength: 500 },
    { label: "Video topic", value: cleanPromptText(topic), maxLength: 90 },
    { label: "Scene dialogue context", value: cleanPromptText(dialogueContext), maxLength: 120 },
    { label: "Shot framing", value: cleanPromptText(shotType, "medium shot"), maxLength: 60 },
    { label: "Camera movement", value: cleanPromptText(cameraMovement, "gentle push-in"), maxLength: 60 }
  ];

  const labelAndLineOverhead = fields.reduce(
    (total, field) => total + field.label.length + 2,
    fields.length
  );
  let remaining = Math.max(
    0,
    CLOUDFLARE_IMAGE_PROMPT_LIMIT - FIXED_IMAGE_INSTRUCTIONS.length - labelAndLineOverhead
  );

  const promptFields = fields.map(field => {
    const value = truncatePromptText(field.value, Math.min(field.maxLength, remaining));
    remaining = Math.max(0, remaining - value.length);
    return field.label + ": " + value;
  });

  const prompt = [FIXED_IMAGE_INSTRUCTIONS, ...promptFields].join("\n");
  if (prompt.length > CLOUDFLARE_IMAGE_PROMPT_LIMIT) {
    throw new Error("Cloudflare image prompt exceeded its safe character limit.");
  }
  return prompt;
}
