import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (process.platform === 'darwin') {
  const env = { ...process.env };
  if (!env.DEVELOPER_DIR && existsSync('/Applications/Xcode.app/Contents/Developer')) env.DEVELOPER_DIR = '/Applications/Xcode.app/Contents/Developer';
  const arch = process.env.OTTO_BUILD_ARCH ?? process.arch;
  const target = arch === 'x64' ? 'x86_64-apple-macosx14.0' : 'arm64-apple-macosx14.0';
  const result = spawnSync('xcrun', ['swiftc', '-swift-version', '6', '-strict-concurrency=complete', '-parse-as-library', '-O',
    '-target', target, 'desktop/native/macos/OttoAX.swift', '-o', 'desktop/native/macos/otto-ax',
    '-framework', 'AppKit', '-framework', 'ApplicationServices'], { stdio: 'inherit', env });
  process.exit(result.status ?? 1);
} else if (process.platform !== 'win32') {
  console.log('Native computer control is available on macOS and Windows. Building the distribution website only.');
}
