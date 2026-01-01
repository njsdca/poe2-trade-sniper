// ========================================
// Divinge - PoE Item Card Renderer
// Generates item card images for Discord
// ========================================

import { createCanvas, loadImage, registerFont } from 'canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Rarity colors
const RARITY_COLORS = {
  0: { name: '#C8C8C8', bg: 'rgba(100, 100, 100, 0.3)' },    // Normal - gray
  1: { name: '#8888FF', bg: 'rgba(50, 50, 120, 0.3)' },      // Magic - blue
  2: { name: '#FFFF77', bg: 'rgba(120, 120, 50, 0.3)' },     // Rare - yellow
  3: { name: '#AF6025', bg: 'rgba(100, 50, 20, 0.3)' },      // Unique - orange
  4: { name: '#1BA29B', bg: 'rgba(20, 80, 80, 0.3)' },       // Gem - teal
  5: { name: '#AA9E82', bg: 'rgba(80, 70, 50, 0.3)' },       // Currency - tan
};

// Border colors by rarity
const BORDER_COLORS = {
  0: '#646464',  // Normal
  1: '#5050A0',  // Magic
  2: '#8C8C32',  // Rare
  3: '#964B00',  // Unique (brown/orange)
  4: '#1BA29B',  // Gem
  5: '#867256',  // Currency
};

export async function renderItemCard(item, options = {}) {
  const frameType = item.frameType || 0;
  const rarityColor = RARITY_COLORS[frameType] || RARITY_COLORS[0];
  const borderColor = BORDER_COLORS[frameType] || BORDER_COLORS[0];

  // Calculate dimensions based on content
  const padding = 20;
  const lineHeight = 22;
  const headerHeight = item.name ? 60 : 40;

  // Collect all content lines
  const sections = [];

  // Properties section
  if (item.properties && item.properties.length > 0) {
    const propLines = item.properties.map(p => {
      if (p.values && p.values.length > 0) {
        return { text: `${p.name}: ${p.values.map(v => v[0]).join(', ')}`, color: '#7F7F7F', valueColor: '#FFFFFF' };
      }
      return { text: p.name, color: '#7F7F7F' };
    });
    sections.push({ lines: propLines, separator: true });
  }

  // Item level
  if (item.ilvl) {
    sections.push({ lines: [{ text: `Item Level: ${item.ilvl}`, color: '#7F7F7F', valueColor: '#FFFFFF' }], separator: true });
  }

  // Requirements
  if (item.requirements && item.requirements.length > 0) {
    const reqText = item.requirements.map(r => `${r.name} ${r.values?.[0]?.[0] || ''}`).join(', ');
    sections.push({ lines: [{ text: `Requires ${reqText}`, color: '#7F7F7F' }], separator: true });
  }

  // Implicit mods
  if (item.implicitMods && item.implicitMods.length > 0) {
    const implicitLines = item.implicitMods.map(m => ({
      text: cleanModText(m),
      color: '#8888FF'
    }));
    sections.push({ lines: implicitLines, separator: true });
  }

  // Explicit mods
  if (item.explicitMods && item.explicitMods.length > 0) {
    const explicitLines = item.explicitMods.map(m => ({
      text: cleanModText(m),
      color: '#8888FF'
    }));
    sections.push({ lines: explicitLines, separator: false });
  }

  // Rune mods
  if (item.runeMods && item.runeMods.length > 0) {
    const runeLines = item.runeMods.map(m => ({
      text: cleanModText(m),
      color: '#64B4FF'
    }));
    sections.push({ lines: runeLines, separator: false });
  }

  // Corrupted
  if (item.corrupted) {
    sections.push({ lines: [{ text: 'Corrupted', color: '#D20000' }], separator: false });
  }

  // Calculate total height
  let contentHeight = headerHeight + padding;
  for (const section of sections) {
    contentHeight += section.lines.length * lineHeight;
    if (section.separator) contentHeight += 15;
  }

  // Add space for item icon if present
  const iconSize = 64;
  if (item.icon) {
    contentHeight += iconSize + 15;
  }

  contentHeight += padding;

  // Create canvas
  const width = 380;
  const height = Math.max(200, contentHeight);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Draw background
  ctx.fillStyle = '#0C0C0C';
  ctx.fillRect(0, 0, width, height);

  // Draw inner background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, rarityColor.bg);
  gradient.addColorStop(0.3, 'rgba(20, 20, 20, 0.9)');
  gradient.addColorStop(1, 'rgba(10, 10, 10, 0.95)');
  ctx.fillStyle = gradient;
  ctx.fillRect(4, 4, width - 8, height - 8);

  // Draw border
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, width - 4, height - 4);

  // Draw inner border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.strokeRect(6, 6, width - 12, height - 12);

  // Draw header background
  const headerGradient = ctx.createLinearGradient(0, 0, 0, headerHeight);
  headerGradient.addColorStop(0, rarityColor.bg);
  headerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = headerGradient;
  ctx.fillRect(8, 8, width - 16, headerHeight);

  // Draw item name
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let y = padding + 12;

  if (item.name) {
    // Two-line header for named items
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rarityColor.name;
    ctx.fillText(item.name, width / 2, y);
    y += 24;

    ctx.font = '16px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rarityColor.name;
    ctx.fillText(item.typeLine, width / 2, y);
    y += 24;
  } else {
    // Single line for unnamed items
    ctx.font = 'bold 18px "Segoe UI", Arial, sans-serif';
    ctx.fillStyle = rarityColor.name;
    ctx.fillText(item.typeLine, width / 2, y + 8);
    y += 32;
  }

  // Draw separator after header
  drawSeparator(ctx, y, width, borderColor);
  y += 15;

  // Draw sections
  ctx.textAlign = 'center';
  ctx.font = '14px "Segoe UI", Arial, sans-serif';

  for (const section of sections) {
    for (const line of section.lines) {
      // Handle lines with value highlighting
      if (line.valueColor && line.text.includes(':')) {
        const [label, value] = line.text.split(':');
        const labelWidth = ctx.measureText(label + ': ').width;
        const totalWidth = ctx.measureText(line.text).width;
        const startX = (width - totalWidth) / 2;

        ctx.textAlign = 'left';
        ctx.fillStyle = line.color;
        ctx.fillText(label + ':', startX, y);
        ctx.fillStyle = line.valueColor;
        ctx.fillText(value, startX + labelWidth, y);
        ctx.textAlign = 'center';
      } else {
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, width / 2, y);
      }
      y += lineHeight;
    }

    if (section.separator) {
      drawSeparator(ctx, y, width, borderColor);
      y += 15;
    }
  }

  // Draw item icon
  if (item.icon) {
    try {
      const icon = await loadImage(item.icon);
      const iconX = (width - iconSize) / 2;
      ctx.drawImage(icon, iconX, y, iconSize, iconSize);
    } catch (e) {
      // Icon failed to load, skip it
    }
  }

  return canvas.toBuffer('image/png');
}

function drawSeparator(ctx, y, width, color) {
  const margin = 30;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.moveTo(margin, y);
  ctx.lineTo(width - margin, y);
  ctx.stroke();

  // Draw small decorations at ends
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(margin, y, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - margin, y, 2, 0, Math.PI * 2);
  ctx.fill();
}

function cleanModText(mod) {
  // Remove [bracketed|formatted] text, keep first part
  return mod.replace(/\[([^\]|]+)\|?[^\]]*\]/g, '$1');
}
