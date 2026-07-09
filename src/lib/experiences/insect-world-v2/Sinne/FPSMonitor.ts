/**
 * FPSMonitor — Zeigt FPS und Frame-Zeit als DOM-Overlay an.
 *
 * Einfach in jede Seite einbaubar:
 *   const fps = new FPSMonitor();
 *   fps.start();
 *   // in der animation loop:
 *   fps.update(performance.now());
 *   // beim aufräumen:
 *   fps.stop();
 *
 * Styling: dezentes dunkles Halbtransparent, oben links.
 */
export class FPSMonitor {
  private container: HTMLDivElement;
  private frameCount = 0;
  private lastTime = 0;
  private fps = 0;
  private running = false;

  /**
   * Erstellt das Overlay-Div (noch unsichtbar).
   * Rufe start() auf, um es anzuzeigen.
   */
  constructor() {
    this.container = document.createElement("div");
    this.container.style.cssText = [
      "position: fixed",
      "top: 12px",
      "left: 12px",
      "background: rgba(0,0,0,0.55)",
      "color: #0f0",
      "font: bold 14px/1.4 monospace",
      "padding: 4px 10px",
      "border-radius: 6px",
      "pointer-events: none",
      "z-index: 9999",
      "user-select: none",
    ].join(";");
    this.container.textContent = "-- FPS";
    this.container.style.display = "none";
  }

  /** Zeigt das Overlay an und startet die Messung. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.fps = 0;
    this.container.style.display = "block";
    document.body.appendChild(this.container);
  }

  /**
   * Wird jeden Frame aufgerufen – z. B. in animate() oder setAnimationLoop().
   * @param now Aktuelle Zeit in ms (performance.now() oder timestamp aus rAF)
   */
  update(now: number): void {
    if (!this.running) return;
    this.frameCount++;
    const elapsed = now - this.lastTime;
    if (elapsed >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / elapsed);
      this.frameCount = 0;
      this.lastTime = now;
      this.container.textContent = `${this.fps} FPS`;
    }
  }

  /** Entfernt das Overlay und stoppt die Messung. */
  stop(): void {
    this.running = false;
    this.container.style.display = "none";
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
