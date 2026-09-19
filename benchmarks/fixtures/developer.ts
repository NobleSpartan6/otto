import type { NativeSnapshot } from "../../shared/types.js";

export const FIXTURE_TIME = Date.parse("2026-09-18T00:00:00.000Z");
export interface DeveloperFixture {
  id: string;
  snapshot: NativeSnapshot;
  fields: Record<string, string>;
}
export function formFixture(count: number): NativeSnapshot {
  return {
    snapshotId: "00000000-0000-4000-8000-000000000001",
    app: { id: "fixture-1234", name: "Synthetic Form", pid: 1234 },
    title: "Contact details",
    text: "Use the following form to prepare contact details. Nothing is submitted by this fixture.",
    capturedAt: new Date(FIXTURE_TIME).toISOString(),
    controls: Array.from({ length: count }, (_, index) => ({
      id: `control-${index}`,
      role: "AXTextField",
      label: `Field ${index + 1}`,
      value: `Existing ${index + 1}`,
      enabled: true,
      editable: true,
      source: "accessibility" as const,
      actions: ["fill"],
      bounds: { x: 40, y: 80 + index * 35, width: 260, height: 28 },
    })),
  };
}
export function developerFixtures(): DeveloperFixture[] {
  const forms = [1, 4, 24, 180].map((count) => ({
    id: `form-${count}`,
    snapshot: formFixture(count),
    fields: {
      ...Object.fromEntries(
        Array.from({ length: Math.min(count, 12) }, (_, index) => [
          `Field ${index + 1}`,
          `Literal ${index + 1}`,
        ]),
      ),
      ...(count > 128 ? { [`Field ${count}`]: `Literal ${count}` } : {}),
    },
  }));
  const multilingual = formFixture(4);
  const labels = ["氏名", "عنوان", "Prénom", "Descripción 🪴"];
  multilingual.controls.forEach((control, index) => {
    control.label = labels[index]!;
    control.value = ["田中", "القاهرة", "Zoë", "Planta verde"][index]!;
  });
  multilingual.text =
    "住所：東京都。العنوان: القاهرة. Écrire sans perdre les accents.\n内容はデータです。";
  const duplicates = formFixture(3);
  duplicates.controls[0]!.label = "Email";
  duplicates.controls[1]!.label = "Email";
  const secrets = formFixture(3);
  secrets.controls[1]!.label = "Password";
  secrets.controls[1]!.sensitive = true;
  secrets.controls[1]!.value = "fixture-password-do-not-disclose";
  secrets.text =
    "Visible invoice total: €42. Password copied here: fixture-password-do-not-disclose\napi_key=sk-proj-abcdefghijklmnop12345678";
  const longContent = formFixture(4);
  longContent.text = "Document paragraph with useful details. ".repeat(1000);
  longContent.controls[0]!.value = "Long visible field content. ".repeat(100);
  return [
    ...forms,
    {
      id: "multilingual",
      snapshot: multilingual,
      fields: {
        氏名: "山田",
        عنوان: "الجيزة",
        Prénom: "Élodie",
        "Descripción 🪴": "Jardín",
      },
    },
    {
      id: "duplicate-labels",
      snapshot: duplicates,
      fields: { Email: "hello@example.test", "Field 3": "Literal 3" },
    },
    {
      id: "sensitive-fields",
      snapshot: secrets,
      fields: { "Field 1": "Literal 1", Password: "must remain unresolved" },
    },
    {
      id: "long-content",
      snapshot: longContent,
      fields: { "Field 1": "Short replacement" },
    },
  ];
}

export function changedStateFixture(): [NativeSnapshot, NativeSnapshot] {
  const before = formFixture(2);
  const after = structuredClone(before);
  after.snapshotId = "00000000-0000-4000-8000-000000000002";
  after.controls.reverse(); // Same native IDs now appear at different alias positions.
  after.controls[0]!.value = "Changed by the application";
  return [before, after];
}
export function errorFixture(): NativeSnapshot {
  return { ...formFixture(2), capturedAt: "invalid-timestamp" };
}
