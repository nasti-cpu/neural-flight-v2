/**
 * backgroundAudio.ts – Sanfte Hintergrund-Atmo für die Unterwasserwelt.
 *
 * Lädt "ambiente unterwasser.mp3" und spielt es in einer Endlosschleife ab.
 *
 * Wichtig: Browser blockieren automatische Audio-Wiedergabe. Deshalb wird
 * der Sound erst gestartet, wenn der Benutzer das erste Mal klickt oder
 * eine Taste drückt (User-Interaction).
 *
 * Falls das Laden fehlschlägt, passiert einfach nichts – die Experience
 * läuft auch ohne Sound problemlos weiter.
 */

/**
 * Startet die Hintergrund-Atmo, sobald der Benutzer interagiert.
 *
 * @returns Ein Objekt zum Stoppen des Sounds, oder null bei Fehler.
 */
export function startBackgroundAudio(): {
  stop: () => void;
} | null {
  try {
    // AudioContext ist anfangs "suspended" – Browser erlauben Audio
    // erst nach einer User-Interaction (Klick, Taste, Touch)
    const audioCtx = new AudioContext();

    // Gain-Knoten für die Lautstärke (sehr leise, sanfte Atmo)
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0.35;
    gainNode.connect(audioCtx.destination);

    // Hier wird der decodierte Sound zwischengespeichert
    let audioBuffer: AudioBuffer | null = null;
    let started = false;

    // =====================================================================
    // 1. Sound-Datei laden und dekodieren (passiert sofort im Hintergrund)
    // =====================================================================
    async function loadAudio(): Promise<void> {
      try {
        const response = await fetch("/sounds/ambiente%20unterwasser.mp3");

        if (!response.ok) {
          console.warn(
            "🔇 Hintergrund-Sound nicht gefunden (HTTP",
            response.status,
            ") – Experience läuft ohne Audio weiter.",
          );
          return;
        }

        const arrayBuffer = await response.arrayBuffer();
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        console.log("📥 Sound geladen und dekodiert – wartet auf User-Interaction...");
      } catch (err) {
        console.warn(
          "🔇 Hintergrund-Sound konnte nicht geladen werden:",
          err,
        );
      }
    }

    loadAudio();

    // =====================================================================
    // 2. Bei der ersten User-Interaction: AudioContext fortsetzen + abspielen
    // =====================================================================
    function onFirstInteraction(): void {
      // Listener nur genau einmal ausführen
      document.removeEventListener("keydown", onFirstInteraction);
      document.removeEventListener("click", onFirstInteraction);
      document.removeEventListener("touchstart", onFirstInteraction);

      // AudioContext vom Browser freischalten lassen
      audioCtx.resume().then(() => {
        if (started) return; // Schon gestartet – nichts tun

        if (audioBuffer) {
          // Neuen Source aus dem gepufferten Sound erstellen
          const source = audioCtx.createBufferSource();
          source.buffer = audioBuffer;
          source.loop = true;
          source.connect(gainNode);
          source.start();
          started = true;
          console.log("🔊 Hintergrund-Atmo gestartet: ambiente unterwasser.mp3");
        } else {
          // Sound ist noch nicht geladen – in 500ms nochmal versuchen
          const retry = setInterval(() => {
            if (audioBuffer) {
              clearInterval(retry);
              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.loop = true;
              source.connect(gainNode);
              source.start();
              started = true;
              console.log("🔊 Hintergrund-Atmo gestartet (verzögert): ambiente unterwasser.mp3");
            }
          }, 200);
        }
      });
    }

    // Auf User-Interaction warten
    document.addEventListener("keydown", onFirstInteraction);
    document.addEventListener("click", onFirstInteraction);
    document.addEventListener("touchstart", onFirstInteraction);

    // =====================================================================
    // 3. Rückgabe: Ein Objekt zum sauberen Stoppen
    // =====================================================================
    return {
      stop: () => {
        document.removeEventListener("keydown", onFirstInteraction);
        document.removeEventListener("click", onFirstInteraction);
        document.removeEventListener("touchstart", onFirstInteraction);
        try {
          audioCtx.close();
          console.log("🔇 Hintergrund-Atmo gestoppt.");
        } catch {
          // AudioContext ließ sich nicht schließen – ignorieren
        }
      },
    };
  } catch (err) {
    console.warn(
      "🔇 AudioContext nicht verfügbar – Experience läuft ohne Sound.",
      err,
    );
    return null;
  }
}