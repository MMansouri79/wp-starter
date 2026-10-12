/** Remove storage coordinates recursively, including nested registry documents. */
export function publicData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !["filePath", "zip", "absoluteFile", "artifactPath"].includes(key)).map(([key, item]) => [key, publicData(item)]));
  }
  return value;
}

export function publicErrorMessage(message: string, root: string): string {
  return message.split(root).join("[library]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[path]")
    .replace(/\/(?:tmp|var|home|Users|srv|opt|mnt)\/[^\s"'<>]+/g, "[path]");
}
