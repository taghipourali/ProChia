import { isDesktop } from './session';

let audio: AudioContext | null = null;

/** Two short tones — audible over a kitchen extractor without being shrill. */
export function chime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.35, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.18);
    }
  } catch {
    /* audio unavailable */
  }
}

/** Desktop notification: native on Windows (Tauri), the browser API otherwise. */
export async function notify(title: string, body: string) {
  if (isDesktop) {
    try {
      const { sendNotification, isPermissionGranted, requestPermission } =
        await import('@tauri-apps/plugin-notification');
      if (!(await isPermissionGranted()) && (await requestPermission()) !== 'granted') return;
      sendNotification({ title, body });
      return;
    } catch {
      /* fall back to the web API */
    }
  }
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission === 'granted')
    new Notification(title, { body, lang: 'fa', dir: 'rtl' });
}
