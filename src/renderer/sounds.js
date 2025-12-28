// ========================================
// Sound Effects
// ========================================

// Pre-load the notification sound
let notificationAudio = null;

function getNotificationAudio() {
  if (!notificationAudio) {
    notificationAudio = new Audio('../assets/notification.mp3');
    notificationAudio.volume = 0.3; // Lower volume for pleasant listening
  }
  return notificationAudio;
}

export function playSound() {
  const audio = getNotificationAudio();

  // Reset to beginning if already playing
  audio.currentTime = 0;

  audio.play().catch(err => {
    console.error('Failed to play notification sound:', err);
  });
}

// Test function for the settings page
export function testSound() {
  playSound();
}
