// Creates debug image showing matched pixels in green
import { Jimp } from 'jimp';
import { readFileSync, writeFileSync } from 'fs';

const HIGHLIGHT_COLOR = {
  r: { min: 100, max: 150 },
  g: { min: 55, max: 100 },
  b: { min: 140, max: 190 }
};

function isHighlightColor(r, g, b) {
  return (
    r >= HIGHLIGHT_COLOR.r.min && r <= HIGHLIGHT_COLOR.r.max &&
    g >= HIGHLIGHT_COLOR.g.min && g <= HIGHLIGHT_COLOR.g.max &&
    b >= HIGHLIGHT_COLOR.b.min && b <= HIGHLIGHT_COLOR.b.max
  );
}

async function createDebugImage(imagePath, outputPath) {
  console.log('Loading image:', imagePath);

  const imgBuffer = readFileSync(imagePath);
  const image = await Jimp.read(imgBuffer);
  const width = image.bitmap.width;
  const height = image.bitmap.height;

  console.log('Image size:', width, 'x', height);

  let matchCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = image.bitmap.data[idx];
      const g = image.bitmap.data[idx + 1];
      const b = image.bitmap.data[idx + 2];

      if (isHighlightColor(r, g, b)) {
        matchCount++;
        // Mark as bright green
        image.bitmap.data[idx] = 0;
        image.bitmap.data[idx + 1] = 255;
        image.bitmap.data[idx + 2] = 0;
      }
    }
  }

  console.log('Marked', matchCount, 'pixels green');

  const pngBuffer = await image.getBuffer('image/png');
  writeFileSync(outputPath, pngBuffer);
  console.log('Saved debug image to:', outputPath);
}

const imagePath = process.argv[2];
const outputPath = process.argv[3] || 'debug-output.png';

if (!imagePath) {
  console.log('Usage: node test-debug-image.mjs <input-image> [output-image]');
  process.exit(1);
}

createDebugImage(imagePath, outputPath);
