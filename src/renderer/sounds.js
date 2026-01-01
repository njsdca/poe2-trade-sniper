// ========================================
// Sound Effects using Web Audio API
// Soft, pleasant notification sounds
// ========================================

let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Create a soft pluck/bell sound
function playBellTone(ctx, freq, startTime, duration, volume) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  // Use sine wave for softest tone
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  // Low-pass filter to remove harshness
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 2, startTime);
  filter.Q.setValueAtTime(1, startTime);

  // Soft attack, natural decay (like a bell/marimba)
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(volume * 0.3, startTime + duration * 0.3);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration + 0.1);
}

// Create a soft synth pad tone
function playPadTone(ctx, freq, startTime, duration, volume) {
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  // Two slightly detuned oscillators for warmth
  osc1.type = 'sine';
  osc2.type = 'sine';
  osc1.frequency.setValueAtTime(freq, startTime);
  osc2.frequency.setValueAtTime(freq * 1.002, startTime); // Slight detune

  // Warm low-pass filter
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(freq * 3, startTime);
  filter.Q.setValueAtTime(0.5, startTime);

  // Soft envelope
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(volume * 0.5, startTime + 0.05);
  gain.gain.linearRampToValueAtTime(volume * 0.3, startTime + duration * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc1.start(startTime);
  osc2.start(startTime);
  osc1.stop(startTime + duration + 0.1);
  osc2.stop(startTime + duration + 0.1);
}

// Sound definitions
const SOUNDS = {
  // Default - soft double ding
  'notification.mp3': (ctx, now) => {
    playBellTone(ctx, 880, now, 0.4, 0.15);
    playBellTone(ctx, 1108, now + 0.15, 0.5, 0.12);
  },

  // Chime - gentle ascending melody
  'chime.mp3': (ctx, now) => {
    playBellTone(ctx, 523, now, 0.5, 0.12);
    playBellTone(ctx, 659, now + 0.12, 0.5, 0.12);
    playBellTone(ctx, 784, now + 0.24, 0.5, 0.12);
    playBellTone(ctx, 1047, now + 0.36, 0.7, 0.15);
  },

  // Alert - gentle attention getter
  'alert.mp3': (ctx, now) => {
    playBellTone(ctx, 740, now, 0.3, 0.15);
    playBellTone(ctx, 740, now + 0.2, 0.3, 0.15);
    playBellTone(ctx, 880, now + 0.4, 0.4, 0.12);
  },

  // Success - warm triumphant chord
  'success.mp3': (ctx, now) => {
    // C major chord arpeggio
    playPadTone(ctx, 523, now, 0.8, 0.15);
    playPadTone(ctx, 659, now + 0.08, 0.72, 0.15);
    playPadTone(ctx, 784, now + 0.16, 0.64, 0.15);
    playBellTone(ctx, 1047, now + 0.3, 0.8, 0.18);
  },

  // Coin - sparkly reward sound
  'coin.mp3': (ctx, now) => {
    playBellTone(ctx, 1318, now, 0.3, 0.1);
    playBellTone(ctx, 1760, now + 0.08, 0.3, 0.1);
    playBellTone(ctx, 2093, now + 0.16, 0.4, 0.12);
    playBellTone(ctx, 2637, now + 0.28, 0.5, 0.15);
  },

  // Legacy
  'alert.wav': (ctx, now) => {
    playBellTone(ctx, 800, now, 0.3, 0.15);
    playBellTone(ctx, 800, now + 0.2, 0.3, 0.15);
  },
};

export function playSound(soundName = 'notification.mp3') {
  const ctx = getAudioContext();

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  const soundFn = SOUNDS[soundName] || SOUNDS['notification.mp3'];
  soundFn(ctx, ctx.currentTime);
}

// Test function for the settings page
export function testSound(soundName = 'notification.mp3') {
  playSound(soundName);
}
