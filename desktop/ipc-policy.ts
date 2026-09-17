export function assertString(
  value: unknown,
  max = 200,
): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error("Invalid request.");
}

export function allowedExternalUrl(input: unknown): string {
  assertString(input, 1000);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid link.");
  }
  const allowed = new Set([
    "github.com",
    "console.typesafe.ai",
    "docs.typesafe.ai",
    "typesafe.ai",
    "platform.openai.com",
  ]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowed.has(url.hostname)
  )
    throw new Error("This external link is not allowed.");
  if (
    url.hostname === "github.com" &&
    !url.pathname.startsWith("/NobleSpartan6/otto")
  )
    throw new Error("This repository link is not allowed.");
  return url.href;
}
