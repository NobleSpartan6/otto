export type Shot = { id: string; name: string; tags: string; transcript: string; duration: number; fileName?: string };
export type Cut = { shotId: string; sourceIn: number; duration: number };
export type Proposal = { id: string; cuts: Cut[] };
export const SLOT_SECONDS = 2;
export const SLOT_COUNT = 6;
export const fixtureShots: Shot[] = [
  ["01", "The empty room", "still wide quiet space anticipation"],
  ["02", "A hand reaches", "detail gesture preparation tension"],
  ["03", "The first light", "soft dawn slow discovery"],
  ["04", "Crossing the threshold", "movement entrance transition reveal"],
  ["05", "Held breath", "closeup still pause intimacy"],
  ["06", "The object", "hero centered reveal clarity"],
  ["07", "A flash of motion", "fast energy impact acceleration"],
  ["08", "The wide world", "wide scale release perspective"],
  ["09", "One last detail", "texture detail quiet resolution"],
  ["10", "Into the light", "movement bright closing release"],
].map(([id, name, tags]) => ({ id: id!, name: name!, tags: tags!, transcript: "", duration: 4 }));
export const initialCut = (shots: Shot[]): Cut[] => shots.slice(0, SLOT_COUNT).map(shot => ({ shotId: shot.id, sourceIn: 0, duration: SLOT_SECONDS }));
export function validateShots(value: unknown): asserts value is Shot[] {
  if (!Array.isArray(value) || value.length < 8 || value.length > 12) throw new Error("Import 8–12 clips for this study.");
  const ids = new Set();
  for (const shot of value) {
    if (!shot || typeof shot.id !== "string" || !/^[a-zA-Z0-9-]{1,40}$/.test(shot.id) || ids.has(shot.id) ||
      typeof shot.name !== "string" || !shot.name.trim() || shot.name.length > 120 ||
      typeof shot.tags !== "string" || !shot.tags.trim() || shot.tags.length > 600 ||
      typeof shot.transcript !== "string" || shot.transcript.length > 1000 ||
      typeof shot.duration !== "number" || !Number.isFinite(shot.duration) || shot.duration < SLOT_SECONDS || shot.duration > 7200 ||
      (shot.fileName !== undefined && (typeof shot.fileName !== "string" || !/^[\w .()-]{1,160}$/.test(shot.fileName))))
      throw new Error("Each clip needs a unique ID, title, tags, and at least two playable seconds. Use simple filenames for export.");
    ids.add(shot.id);
  }
}
export function validateCut(shots: Shot[], cuts: Cut[]) {
  if (!Array.isArray(cuts) || cuts.length !== SLOT_COUNT) throw new Error("A cut must contain six shots.");
  const used = new Set();
  for (const cut of cuts) {
    const shot = shots.find(s => s.id === cut.shotId);
    if (!shot || used.has(cut.shotId) || cut.duration !== SLOT_SECONDS || cut.sourceIn !== 0 || shot.duration < cut.duration) throw new Error("Invalid cut: six distinct, two-second selections are required.");
    used.add(cut.shotId);
  }
}
/** Bounded candidates, not a semantic editor. The model chooses among these whole cuts. */
export function proposals(shots: Shot[], current: Cut[], locks: number[]): Proposal[] {
  validateShots(shots); validateCut(shots, current);
  if (!Array.isArray(locks) || locks.some(n => !Number.isInteger(n) || n < 0 || n >= SLOT_COUNT) || new Set(locks).size !== locks.length) throw new Error("Invalid locked slots.");
  const reserved = new Set(locks.map(i => current[i]!.shotId));
  const free = shots.filter(s => !reserved.has(s.id));
  const seen = new Set<string>(); const result: Proposal[] = [];
  for (let offset = 0; offset < free.length; offset++) for (const reverse of [false, true]) {
    const ordered = Array.from({ length: free.length }, (_, i) => free[(offset + (reverse ? free.length - i : i)) % free.length]!);
    let cursor = 0;
    const cuts = current.map((cut, i) => locks.includes(i) ? { ...cut } : { shotId: ordered[cursor++]!.id, sourceIn: 0, duration: SLOT_SECONDS });
    const key = cuts.map(c => c.shotId).join(",");
    if (!seen.has(key)) { seen.add(key); result.push({ id: `cut-${result.length + 1}`, cuts }); }
  }
  return result;
}
export function applyProposal(shots: Shot[], current: Cut[], locks: number[], proposal: Proposal): Cut[] {
  validateCut(shots, proposal.cuts);
  if (locks.some(i => JSON.stringify(current[i]) !== JSON.stringify(proposal.cuts[i]))) throw new Error("The proposed cut changed a locked shot.");
  return proposal.cuts.map(c => ({ ...c }));
}
export function diffusionSource(shots: Shot[], cuts: Cut[], fixtures: boolean): string {
  validateShots(shots); validateCut(shots, cuts);
  const body = cuts.map((cut, i) => {
    const shot = shots.find(s => s.id === cut.shotId)!;
    const start = i * SLOT_SECONDS, end = start + SLOT_SECONDS;
    if (!fixtures && !shot.fileName) throw new Error("Missing media filename.");
    return fixtures
      ? `      <group id="shot-${i}" start={${start}} end={${end}}><rect width={1920} height={1080} fill="#17191b" /><text x={110} y={130} fontFamily="Inter" fontSize={28} fill="#a8abae">TEST SLATE · NO FOOTAGE</text><text x={100} y={290} fontFamily="Inter" fontSize={240} fill="#e1e5e8">${shot.id}</text><text x={110} y={800} fontFamily="Inter" fontSize={52} fill="white">{${JSON.stringify(shot.name)}}</text></group>`
      : `      <video id="shot-${i}" src={${JSON.stringify(shot.fileName)}} start={${start}} end={${end}} sourceIn={0} sourceOut={2} width={1920} height={1080} objectFit="contain" muted />`;
  }).join("\n");
  return `// Otto Locked Cut — ${fixtures ? "authored test slates, not footage or model evidence" : "place the original clips in assets/; muted assembly"}\nexport default function Project() {\n  return <stage><scene id="locked-cut" name="Otto — Locked Cut" width={1920} height={1080} fill="#17191b" active><sequence id="story" name="Story">\n${body}\n  </sequence></scene></stage>;\n}\n`;
}
