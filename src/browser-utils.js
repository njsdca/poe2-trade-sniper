import { existsSync } from 'fs';

// Detect Chrome or Edge on Windows/macOS
export function findBrowserExecutable() {
  const paths = [
    // Chrome paths (Windows)
    process.env['PROGRAMFILES'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
    process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
    // Edge paths (Windows)
    process.env['PROGRAMFILES'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env['PROGRAMFILES(X86)'] + '\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS (for development)
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];

  for (const browserPath of paths) {
    if (browserPath && existsSync(browserPath)) {
      return browserPath;
    }
  }
  return null;
}
