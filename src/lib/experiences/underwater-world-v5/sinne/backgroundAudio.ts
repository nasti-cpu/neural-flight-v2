/**
 * backgroundAudio.ts – Sanfte Hintergrund-Atmo für die Unterwasserwelt.
 *
 * Lädt "ambiente unterwasser.mp3" und spielt es in einer Endlosschleife ab.
 * Falls das Laden fehlschlägt, passiert einfach nichts – die Experience
 * läuft auch ohne Sound problemlos weiter.
 */

/**
 * Versucht, den Hintergrund-Sound zu starten.
 *
 * @returns Ein Objekt zum Stoppen des Sounds, oder null bei Fehler.
 */
export function startBackgroundAudio(): {
  stop: () => void;
} | null {
  try {
    // AudioContext erstellen (wichtig: in modernen Browsern nur nach User-Gesture)
    const audioCtx = new AudioContext();

    // Hilfsfunktion zum Laden einer Sound-Datei
    async function loadAndPlay(): Promise<void> {
      try {
        // Sound-Datei vom Server laden
        const response = await fetch("/sounds/ambiente%20unterwasser.mp3");

        // Wenn die Datei nicht gefunden wurde, nichts tun
        if (!response.ok) {
          console.warn(
            "🔇 Hintergrund-Sound nicht gefunden (HTTP",
            response.status,
            ") – Experience läuft ohne Audio weiter.",
          );
          return;
        }

        // Audio-Daten dekodieren
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Einen Gain-Knoten für die Lautstärke (sehr leise, sanfter Hintergrund)
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.12; // Leise – nur sanfte Atmo
        gainNode.connect(audioCtx.destination);

        // Source erstellen und in einer Schleife abspielen
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.loop = true; // Endlosschleife
        source.connect(gainNode);
        source.start();

        console.log("🔊 Hintergrund-Atmo gestartet: ambiente unterwasser.mp3");
      } catch (err) {
        // Bei jedem Fehler: Sound ignorieren, Experience läuft weiter
        console.warn(
          "🔇 Hintergrund-Sound konnte nicht geladen/abgespielt werden:",
          err,
        );
      }
    }

    // Laden starten (async – Fehler werden intern abgefangen)
    loadAndPlay();

    // Ein Objekt zum Stoppen des Sounds zurückgeben
    return {
      stop: () => {
        try {
          audioCtx.close();
          console.log("🔇 Hintergrund-Atmo gestoppt.");
        } catch {
          // AudioContext ließ sich nicht schließen – ignorieren
        }
      },
    };
  } catch (err) {
    // AudioContext konnte nicht erstellt werden (z. B. älterer Browser)
    console.warn(
      "🔇 AudioContext nicht verfügbar – Experience läuft ohne Sound.",
      err,
    );
    return null;
  }
}