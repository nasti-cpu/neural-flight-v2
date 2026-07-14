# AGENTS.md – Projektregeln für "HP Borrowed Senses"

## Zielgruppe
Die Entwicklerin ist eine **Coding-Anfängerin**. Der Code muss leicht verständlich sein.

## Allgemeine Regeln

### 1. Datei-Kopf
Jede Datei beginnt mit einem kurzen Kommentar, der beschreibt, was die Datei macht.

```ts
/**
 * Diese Datei enthält die Three.js-Szene für Experiment 01.
 * Ein blauer Würfel rotiert im Raum.
 */
```

### 2. Erklärungen
- Erkläre **immer**, was du tust und warum.
- Kommentiere den Code so, dass jede Zeile nachvollziehbar ist.
- Nutze deutsche oder englische Kommentare – konsistent pro Datei.

### 3. Code-Struktur
- **Modularer Aufbau**: Jede Funktionalität in eine eigene Datei / Funktion auslagern.
- **Separation of Concerns**: Rendering, Szene, Animation, Beleuchtung etc. getrennt halten.
- **Kurze Funktionen**: Jede Funktion erfüllt genau **eine** Aufgabe.
- Keine Funktion länger als ~20 Zeilen.

### 4. Technologie-Stack
- **Three.js** für 3D-Rendering
- **Immer WebGPU** nutzen (`WebGPURenderer`), **niemals WebGL** (`WebGLRenderer`)
- **Immer TSL** (Three.js Shading Language) für eigene Shader/Materialien verwenden
- TypeScript mit **strengen Typen**

### 5. Performance
- **Performance ist König** – jeder Code wird auf Effizienz geprüft.
- Unnötige Objekterstellung in der Render-Loop vermeiden.
- Geometrien und Materialien wiederverwenden.
- `requestAnimationFrame` korrekt nutzen.

### 6. VR
- Das Projekt ist für **VR** ausgelegt.
- Interaktionen und UI müssen VR-tauglich sein.
- Kamera und Controls mit VR-Kompatibilität planen.

## Datei-Konventionen
- Experimente liegen als `.html`-Dateien in `src/`
- TypeScript-Module liegen in `src/`
- Jedes Experiment hat eine eigene HTML-Datei
- Die `index.html` im Root ist die Übersichtsseite

## Aufgaben befolgen
- mache immer das, wozu du aufgefordert wurdest
- immer git check point machen vor änderungen

##
