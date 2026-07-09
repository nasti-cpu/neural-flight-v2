/**
 * fps-counter.ts – Einfacher FPS-Zähler für die VR-Experience.
 *
 * Zeigt die aktuelle Bildrate (FPS) als DOM-Overlay an.
 * Kann nach Belieben ein-/ausgeschaltet werden.
 */

export class FpsCounter {
  private element: HTMLDivElement;
  private frameCount = 0;
  private lastTime = performance.now();
  private fps = 0;

  constructor() {
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed;
      top: 8px;
      left: 8px;
      color: #0f0;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      background: rgba(0,0,0,0.6);
      padding: 4px 10px;
      border-radius: 4px;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
    `;
    this.element.textContent = "-- FPS";
    document.body.appendChild(this.element);
  }

  /** Einmal pro Frame aufrufen */
  update(): void {
    this.frameCount++;
    const now = performance.now();
    const elapsed = now - this.lastTime;

    if (elapsed >= 500) {
      this.fps = Math.round((this.frameCount / elapsed) * 1000);
      this.element.textContent = `${this.fps} FPS`;
      this.frameCount = 0;
      this.lastTime = now;
    }
  }

  /** Aus DOM entfernen */
  dispose(): void {
    this.element.remove();
  }
}