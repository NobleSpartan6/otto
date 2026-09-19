import './check-release-tag.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
if (!repository || !process.env.GH_TOKEN) throw new Error('GitHub release credentials are unavailable.');
const directory = 'artifacts';
const assets = readdirSync(directory).filter(file => /^Otto-.*\.(dmg|zip|exe)$/.test(file)).sort();
if (assets.length !== 5 || !assets.some(file => file.endsWith('-mac-arm64.dmg')) || !assets.some(file => file.endsWith('-mac-x64.dmg')) || !assets.some(file => file.endsWith('-win-x64.exe'))) throw new Error('Expected macOS arm64/x64 DMG+ZIP and Windows x64 EXE assets.');
const sums = assets.map(file => `${createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')}  ${file}`).join('\n') + '\n';
const checksumFile = join(directory, 'SHA256SUMS.txt');
writeFileSync(checksumFile, sums);
const notesFile = join(directory, 'alpha-notes.md');
writeFileSync(notesFile, `Early alpha for macOS and Windows.

- **Fill a form:** review exact text edits once, then verify every field through native readback. No model calls or provider key. The app may autosave; Otto issues no Submit action.
- **Task dictation:** optional native speech-to-text drafts your task. It never starts a task or approves an action. On-device recognition availability varies.
- **Guided tasks:** bring your TypeSafe key; Hybrid mode also requires an OpenAI Platform key.
- **macOS:** Apple Silicon and Intel. Ad-hoc bundle integrity is checked in CI; no Developer ID or notarization. After an update, an enabled Accessibility entry can still reference the old build. Remove the old Otto entry and add the installed /Applications/Otto.app again if access remains unavailable.
- **Windows:** x64 installer, without publisher signing.
- CI checks tests, compilation, and the read-only native protocol. It does not establish broad app compatibility or end-to-end voice recognition. See the repository validation notes for the measured scope.

See the README for setup and limitations. SHA256SUMS.txt contains asset checksums.
`);
const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'isPrerelease'], { encoding: 'utf8' });
if (existing.status === 0) {
  if (!JSON.parse(existing.stdout).isPrerelease) throw new Error('Refusing to replace assets on a non-prerelease release.');
} else {
  execFileSync('gh', ['release', 'create', tag, '--repo', repository, '--verify-tag', '--prerelease', '--title', `Otto ${tag} - unsigned alpha`, '--notes-file', notesFile], { stdio: 'inherit' });
}
execFileSync('gh', ['release', 'upload', tag, '--repo', repository, '--clobber', ...assets.map(file => join(directory, file)), checksumFile], { stdio: 'inherit' });
