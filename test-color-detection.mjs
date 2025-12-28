// Test script to verify optimized color detection with clustering
import { Jimp } from 'jimp';
import { readFileSync } from 'fs';

const HIGHLIGHT_COLOR = {
  r: { min: 100, max: 150 },
  g: { min: 55, max: 100 },
  b: { min: 140, max: 190 }
};

const MIN_HIGHLIGHT_PIXELS = 15;
const CELL_SIZE = 80;
const SKIP_PIXELS = 3;

function isHighlightColor(r, g, b) {
  return (
    r >= HIGHLIGHT_COLOR.r.min && r <= HIGHLIGHT_COLOR.r.max &&
    g >= HIGHLIGHT_COLOR.g.min && g <= HIGHLIGHT_COLOR.g.max &&
    b >= HIGHLIGHT_COLOR.b.min && b <= HIGHLIGHT_COLOR.b.max
  );
}

async function testImage(imagePath) {
  const start = Date.now();
  console.log('Testing image:', imagePath);

  const imgBuffer = readFileSync(imagePath);
  const image = await Jimp.read(imgBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  console.log('Image size:', width, 'x', height);

  const gridWidth = Math.ceil(width / CELL_SIZE);
  const gridHeight = Math.ceil(height / CELL_SIZE);
  const grid = new Array(gridWidth * gridHeight).fill(0);

  // Optimized: sample every SKIP_PIXELS pixel
  for (let y = 0; y < height; y += SKIP_PIXELS) {
    for (let x = 0; x < width; x += SKIP_PIXELS) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        const cellX = Math.floor(x / CELL_SIZE);
        const cellY = Math.floor(y / CELL_SIZE);
        grid[cellY * gridWidth + cellX]++;
      }
    }
  }

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

  console.log('Densest cell:', maxCellX, maxCellY, 'with', maxCount, 'pixels');

  if (maxCount < MIN_HIGHLIGHT_PIXELS) {
    console.log('Not enough pixels in densest cell');
    return;
  }

  const searchMinX = Math.max(0, (maxCellX - 1) * CELL_SIZE);
  const searchMaxX = Math.min(width, (maxCellX + 2) * CELL_SIZE);
  const searchMinY = Math.max(0, (maxCellY - 1) * CELL_SIZE);
  const searchMaxY = Math.min(height, (maxCellY + 2) * CELL_SIZE);

  let minX = width, maxX = 0, minY = height, maxY = 0;

  for (let y = searchMinY; y < searchMaxY; y += 2) {
    for (let x = searchMinX; x < searchMaxX; x += 2) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const centerX = Math.round((minX + maxX) / 2);
  const centerY = Math.round((minY + maxY) / 2);
  const elapsed = Date.now() - start;

  console.log('Bounding box: (' + minX + ',' + minY + ') to (' + maxX + ',' + maxY + ')');
  console.log('Center (click target):', centerX, centerY);
  console.log('Processing time:', elapsed, 'ms');
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.log('Usage: node test-color-detection.mjs <image-path>');
  process.exit(1);
}

testImage(imagePath);
