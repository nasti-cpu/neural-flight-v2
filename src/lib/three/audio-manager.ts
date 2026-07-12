/**
 * Audio Manager – lädt und spielt eine Hintergrund-Tondatei.
 * Nutzt THREE.Audio + AudioListener.
 * WebGPU-konform (kein WebGL).
 */
import * as THREE from "three/webgpu";

/**
 * Lädt eine MP3-Datei und spielt sie als Dauerschleife (Loop) im Hintergrund ab.
 * Hängt einen AudioListener an die Kamera (für VR-Kompatibilität).
 *
 * @param camera  Die Kamera (Listener wird an sie gehängt → folgt Kopfposition in VR)
 * @param url     Pfad/URL zur MP3-Datei
 * @param volume  Lautstärke (0–1), Default 0.3
 */
export async function loadBackgroundAudio(
  camera: THREE.Camera,
  url: string,
  volume = 0.3,
): Promise<THREE.Audio> {
  const listener = new THREE.AudioListener();
  camera.add(listener);

  const audio = new THREE.Audio(listener);
  const loader = new THREE.AudioLoader();

  const buffer = await loader.loadAsync(url);
  audio.setBuffer(buffer);
  audio.setLoop(true);
  audio.setVolume(volume);
  audio.play();

  return audio;
}
