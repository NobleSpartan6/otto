export function parseFillFields(source: string): Record<string, string> {
  if (source.length > 200_000)
    throw new Error(
      "The pasted source is too large. Keep only the field names and values for this form.",
    );
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(
      'Paste a JSON object with quoted field names and text values, such as {"City": "Portland"}.',
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Use one JSON object containing field names and text values.",
    );
  const pairs = Object.entries(value);
  if (!pairs.length || pairs.length > 16)
    throw new Error("Include between 1 and 16 fields.");
  if (
    pairs.some(
      ([label, text]) =>
        !label.trim() ||
        label.length > 256 ||
        typeof text !== "string" ||
        text.includes("\0"),
    )
  )
    throw new Error(
      "Each field needs a name and a quoted text value. Numbers, lists, and nested objects aren’t supported.",
    );
  if (pairs.some(([, text]) => (text as string).length > 2000))
    throw new Error("Keep each field value within 2,000 characters.");
  if (
    pairs.reduce((total, [, text]) => total + (text as string).length, 0) >
    16_000
  )
    throw new Error("Keep all field values within 16,000 characters total.");
  // Scan structural tokens, not just string values: JSON.parse silently keeps the
  // last duplicate even if an earlier value was a number, object, or array.
  const seen = new Set<string>();
  let depth = 0;
  let precedingString: string | null = null;
  for (const match of source.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:]/g)) {
    const token = match[0];
    if (token === "{" || token === "[") {
      depth++;
      precedingString = null;
    } else if (token === "}" || token === "]") {
      depth--;
      precedingString = null;
    } else if (token === ":" && depth === 1 && precedingString !== null) {
      const label = (JSON.parse(precedingString) as string)
        .trim()
        .normalize("NFC");
      if (seen.has(label))
        throw new Error(
          `The field “${label}” appears more than once. Keep one value per field.`,
        );
      seen.add(label);
      precedingString = null;
    } else
      precedingString = token.startsWith('"') && depth === 1 ? token : null;
  }
  return value as Record<string, string>;
}
