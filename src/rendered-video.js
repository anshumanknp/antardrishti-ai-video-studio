const MIME_EXTENSIONS = new Map([["video/mp4","mp4"],["video/webm","webm"]]);
export function getRenderedVideoExtension(contentType) {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  const extension = MIME_EXTENSIONS.get(mime);
  if (!extension) throw new Error("Rendered video must be MP4 or WebM.");
  return extension;
}
export function buildRenderedVideoFileName(jobId, extension) {
  const id = String(jobId || ""), ext = String(extension || "").toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/i.test(id)) throw new Error("Invalid video job ID.");
  if (!["mp4","webm"].includes(ext)) throw new Error("Rendered video extension must be MP4 or WebM.");
  return "antardrishti-" + id + "-final." + ext;
}
