// ========================================
// Auto-Purchase Module
// Automatically purchases highlighted items after teleport
// ========================================

import screenshot from 'screenshot-desktop';
import { Jimp } from 'jimp';
import { mouse, keyboard, Key, Point } from '@nut-tree-fork/nut-js';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// Purple border highlight color (#794da5 = RGB 121, 77, 165)
const HIGHLIGHT_COLOR = {
  r: { min: 100, max: 150 },   // ~121
  g: { min: 55, max: 100 },    // ~77
  b: { min: 140, max: 190 }    // ~165
};

// Minimum pixels needed to consider it a valid highlight (adjusted for pixel skipping)
const MIN_HIGHLIGHT_PIXELS = 15;

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
 * Find the bounding box of highlighted pixels using grid-based clustering
 * Divides screen into cells and finds the cell with highest purple pixel density
 * Optimized: samples every SKIP_PIXELS pixel for speed
 */
async function findHighlightBounds(imageBuffer) {
  const image = await Jimp.read(imageBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  // Grid cell size - roughly item-sized regions
  const CELL_SIZE = 80;
  // Skip pixels for speed (sample every Nth pixel)
  const SKIP_PIXELS = 3;

  const gridWidth = Math.ceil(width / CELL_SIZE);
  const gridHeight = Math.ceil(height / CELL_SIZE);

  // Count purple pixels in each grid cell
  const grid = new Array(gridWidth * gridHeight).fill(0);

  // Sample every SKIP_PIXELS pixel for speed (~9x faster with skip=3)
  for (let y = 0; y < height; y += SKIP_PIXELS) {
    for (let x = 0; x < width; x += SKIP_PIXELS) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx + 0];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        const cellX = Math.floor(x / CELL_SIZE);
        const cellY = Math.floor(y / CELL_SIZE);
        grid[cellY * gridWidth + cellX]++;
      }
    }
  }

  // Find the cell with the most purple pixels
  let maxCount = 0;
  let maxCellX = 0;
  let maxCellY = 0;

  for (let cy = 0; cy < gridHeight; cy++) {
    for (let cx = 0; cx < gridWidth; cx++) {
      const count = grid[cy * gridWidth + cx];
      if (count > maxCount) {
        maxCount = count;
        maxCellX = cx;
        maxCellY = cy;
      }
    }
  }

  if (maxCount < MIN_HIGHLIGHT_PIXELS) {
    return null; // No significant highlight found
  }

  // Now find exact bounds within the winning cell and neighbors (also use skip for speed)
  const searchMinX = Math.max(0, (maxCellX - 1) * CELL_SIZE);
  const searchMaxX = Math.min(width, (maxCellX + 2) * CELL_SIZE);
  const searchMinY = Math.max(0, (maxCellY - 1) * CELL_SIZE);
  const searchMaxY = Math.min(height, (maxCellY + 2) * CELL_SIZE);

  let minX = width, maxX = 0, minY = height, maxY = 0;
  let highlightPixels = 0;

  for (let y = searchMinY; y < searchMaxY; y += 2) {
    for (let x = searchMinX; x < searchMaxX; x += 2) {
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

  console.log(`[AutoPurchase] Found cluster at (${maxCellX},${maxCellY}), center: (${Math.round((minX + maxX) / 2)},${Math.round((minY + maxY) / 2)})`);

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
  try {
    console.log('[AutoPurchase] Taking screenshot...');
    const imgBuffer = await screenshot({ format: 'png' });
    console.log(`[AutoPurchase] Screenshot captured, size: ${imgBuffer.length} bytes`);

    console.log('[AutoPurchase] Loading image with jimp...');
    const image = await Jimp.read(imgBuffer);
    const width = image.bitmap.width;
    const height = image.bitmap.height;
    console.log(`[AutoPurchase] Image loaded: ${width}x${height}`);

    let highlightCount = 0;

    // Mark highlight pixels in bright green
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = image.bitmap.data[idx + 0];
        const g = image.bitmap.data[idx + 1];
        const b = image.bitmap.data[idx + 2];

        if (isHighlightColor(r, g, b)) {
          highlightCount++;
          // Mark as bright green
          image.bitmap.data[idx + 0] = 0;
          image.bitmap.data[idx + 1] = 255;
          image.bitmap.data[idx + 2] = 0;
        }
      }
    }

    console.log(`[AutoPurchase] Found ${highlightCount} matching pixels`);

    // Save debug image to desktop using getBuffer + fs
    const desktopPath = path.join(os.homedir(), 'Desktop', 'divinge-debug-highlight.png');
    console.log(`[AutoPurchase] Saving to: ${desktopPath}`);

    // Get PNG buffer from jimp and write with fs
    const pngBuffer = await image.getBuffer('image/png');
    await fs.writeFile(desktopPath, pngBuffer);
    console.log(`[AutoPurchase] Debug image saved successfully`);

    const bounds = await findHighlightBounds(imgBuffer);
    console.log('[AutoPurchase] Highlight bounds:', bounds);

    return bounds;
  } catch (err) {
    console.error('[AutoPurchase] Debug error:', err);
    throw err;
  }
}

export default { autoPurchase, debugHighlightDetection };
