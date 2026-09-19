import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const tag = process.env.RELEASE_TAG ?? '';
if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)) throw new Error('Release must use an existing vMAJOR.MINOR.PATCH[-prerelease] tag.');
const tagged = execFileSync('git', ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (tagged !== head) throw new Error('Checkout does not match the requested release tag.');
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (tag.slice(1) !== version) throw new Error('The tag version must exactly match package.json, including its prerelease suffix.');
console.log(`Validated ${tag} at ${head}.`);
