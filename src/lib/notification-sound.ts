/**
 * Notification-Sound — kurzer "ding" via Web Audio API generiert.
 *
 * Settings sind Geraete-lokal (localStorage), nicht servergespeichert —
 * Lautstaerke-Praeferenz unterscheidet sich pro Browser/Headphone-State.
 *
 * Sound: ein gespielter ChirpUp von 880Hz auf 1320Hz ueber 120ms mit
 * Linear-Fade-Out. Kurz und unaufdringlich.
 *
 * Browser-Caveat: AudioContext darf nur nach User-Gesture (Click) erzeugt
 * werden. Da wir Sound nur abspielen wenn die App geoeffnet ist und der
 * User die Glocke schon mal benutzt hat, ist das in der Praxis ok —
 * playNotificationSound() wird der erste Aufruf ggf. stumm sein.
 */

const KEY = "notifications:sound";

export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) !== "off";
}

export function setSoundEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, enabled ? "on" : "off");
}

let cachedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!cachedCtx) cachedCtx = new Ctx();
  return cachedCtx;
}

export function playNotificationSound() {
  if (!isSoundEnabled()) return;
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch {
    // Best-effort — Sound darf nie was crashen.
  }
}
