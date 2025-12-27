// ========================================
// Sound Effects using Web Audio API
// ========================================

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Sound presets - frequency patterns for different alert types
const SOUND_PRESETS = {
  'alert.wav': {
    // Urgent double beep
    notes: [
      { freq: 880, duration: 0.1, delay: 0 },
      { freq: 880, duration: 0.1, delay: 0.15 },
    ],
    type: 'square',
    volume: 0.3,
  },
  'chime.wav': {
    // Pleasant ascending chime
    notes: [
      { freq: 523, duration: 0.15, delay: 0 },
      { freq: 659, duration: 0.15, delay: 0.1 },
      { freq: 784, duration: 0.2, delay: 0.2 },
    ],
    type: 'sine',
    volume: 0.25,
  },
  'bell.wav': {
    // Single bell tone with decay
    notes: [
      { freq: 800, duration: 0.4, delay: 0 },
    ],
    type: 'sine',
    volume: 0.3,
  },
  'ping.wav': {
    // Quick high ping
    notes: [
      { freq: 1200, duration: 0.08, delay: 0 },
    ],
    type: 'sine',
    volume: 0.25,
  },
};

export function playSound(soundName = 'alert.wav') {
  const preset = SOUND_PRESETS[soundName] || SOUND_PRESETS['alert.wav'];
  const ctx = getAudioContext();

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const now = ctx.currentTime;

  preset.notes.forEach(note => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = preset.type;
    oscillator.frequency.setValueAtTime(note.freq, now + note.delay);

    // Envelope: quick attack, sustain, decay
    gainNode.gain.setValueAtTime(0, now + note.delay);
    gainNode.gain.linearRampToValueAtTime(preset.volume, now + note.delay + 0.01);
    gainNode.gain.setValueAtTime(preset.volume, now + note.delay + note.duration * 0.7);
    gainNode.gain.linearRampToValueAtTime(0, now + note.delay + note.duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(now + note.delay);
    oscillator.stop(now + note.delay + note.duration + 0.05);
  });
}

// Test function for the settings page
export function testSound(soundName = 'alert.wav') {
  playSound(soundName);
}
