// ========================================
// Auto-Purchase Module
// Automatically purchases highlighted items after teleport
// ========================================

import screenshot from 'screenshot-desktop';
import { Jimp } from 'jimp';
import { mouse, keyboard, Key, Point } from '@nut-tree-fork/nut-js';

// Purple item highlight border color
// The border pulses in brightness but stays purple/violet
const HIGHLIGHT_COLOR = {
  r: { min: 80, max: 180 },   // Moderate red
  g: { min: 0, max: 60 },      // Very low green
  b: { min: 120, max: 220 }    // High blue
};

// Minimum pixels needed to consider it a valid highlight
const MIN_HIGHLIGHT_PIXELS = 100;

// Retry settings for auto-purchase - must be FAST for sniping
const RETRY_INTERVAL = 50;       // ms between attempts (20 checks per second)
const MAX_ATTEMPTS = 200;        // Maximum attempts (10 seconds total)
const POST_CLICK_DELAY = 100;    // ms to wait after click before verifying

/**
 * Check if a pixel color matches any of the highlight color ranges
 */
function isHighlightColor(r, g, b) {
  return (
    r >= HIGHLIGHT_COLOR.r.min && r <= HIGHLIGHT_COLOR.r.max &&
    g >= HIGHLIGHT_COLOR.g.min && g <= HIGHLIGHT_COLOR.g.max &&
    b >= HIGHLIGHT_COLOR.b.min && b <= HIGHLIGHT_COLOR.b.max
  );
}

/**
 * Find the bounding box of magenta highlighted pixels in the image
 */
async function findHighlightBounds(imageBuffer) {
  const image = await Jimp.read(imageBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let highlightPixels = 0;

  // Iterate through all pixels manually (jimp v1.x API)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx + 0];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        highlightPixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (highlightPixels < MIN_HIGHLIGHT_PIXELS) {
    return null; // No significant highlight found
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: Math.round((minX + maxX) / 2),
    centerY: Math.round((minY + maxY) / 2),
    width: maxX - minX,
    height: maxY - minY,
    pixelCount: highlightPixels,
  };
}

/**
 * Capture screenshot and find the highlighted item
 */
async function findHighlightedItem() {
  try {
    // Capture the screen
    const imgBuffer = await screenshot({ format: 'png' });

    // Find the highlight bounds
    const bounds = await findHighlightBounds(imgBuffer);

    if (!bounds) {
      return null;
    }

    console.log(`[AutoPurchase] Found highlight at (${bounds.centerX}, ${bounds.centerY}), size: ${bounds.width}x${bounds.height}`);
    return bounds;
  } catch (err) {
    console.error('[AutoPurchase] Error capturing/analyzing screen:', err);
    return null;
  }
}

/**
 * Perform Ctrl+Click at the specified position
 */
async function ctrlClickAt(x, y) {
  try {
    // Move mouse to position
    await mouse.setPosition(new Point(x, y));

    // Small delay to ensure mouse is in position
    await delay(50);

    // Hold Ctrl, click, release Ctrl
    await keyboard.pressKey(Key.LeftControl);
    await mouse.leftClick();
    await keyboard.releaseKey(Key.LeftControl);

    console.log(`[AutoPurchase] Ctrl+Click performed at (${x}, ${y})`);
    return true;
  } catch (err) {
    console.error('[AutoPurchase] Error performing click:', err);
    return false;
  }
}

/**
 * Helper function for delays
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main auto-purchase function
 * Call this after a successful teleport
 * Retries until highlight is found, clicked, and disappears (purchase confirmed)
 */
export async function autoPurchase() {
  console.log('[AutoPurchase] Starting auto-purchase sequence...');

  let attempts = 0;
  let highlight = null;

  // Phase 1: Wait for highlight to appear (merchant window to load)
  // Polls rapidly with minimal logging for speed
  while (attempts < MAX_ATTEMPTS) {
    attempts++;
    highlight = await findHighlightedItem();

    if (highlight) {
      console.log(`[AutoPurchase] Highlight found on attempt ${attempts} (${attempts * RETRY_INTERVAL}ms)`);
      break;
    }

    await delay(RETRY_INTERVAL);
  }

  if (!highlight) {
    console.log('[AutoPurchase] Could not find highlighted item after max attempts');
    return { success: false, reason: 'no_highlight' };
  }

  // Phase 2: Click the highlighted item
  const clicked = await ctrlClickAt(highlight.centerX, highlight.centerY);

  if (!clicked) {
    return { success: false, reason: 'click_failed' };
  }

  // Phase 3: Verify purchase by checking if highlight disappeared
  await delay(POST_CLICK_DELAY);
  const highlightAfterClick = await findHighlightedItem();

  if (!highlightAfterClick) {
    console.log('[AutoPurchase] Purchase confirmed - highlight disappeared');
    return { success: true, position: { x: highlight.centerX, y: highlight.centerY } };
  } else {
    console.log('[AutoPurchase] Highlight still present - purchase may have failed');
    return { success: false, reason: 'highlight_still_present' };
  }
}

/**
 * Test function to debug highlight detection
 * Saves a debug image showing detected highlight pixels
 */
export async function debugHighlightDetection() {
  const imgBuffer = await screenshot({ format: 'png' });
  const image = await Jimp.read(imgBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  // Mark highlight pixels in bright green
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx + 0];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        // Mark as bright green
        image.bitmap.data[idx + 0] = 0;
        image.bitmap.data[idx + 1] = 255;
        image.bitmap.data[idx + 2] = 0;
      }
    }
  }

  // Save debug image to desktop
  const os = await import('os');
  const pathMod = await import('path');
  const desktopPath = pathMod.join(os.homedir(), 'Desktop', 'divinge-debug-highlight.png');
  await image.write(desktopPath);
  console.log(`[AutoPurchase] Debug image saved to ${desktopPath}`);

  const bounds = await findHighlightBounds(imgBuffer);
  console.log('[AutoPurchase] Highlight bounds:', bounds);

  return bounds;
}

export default { autoPurchase, debugHighlightDetection };
