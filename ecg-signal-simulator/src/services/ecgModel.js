// ============================================================
// Modelo ECG sintético del lado del servidor (suma de gaussianas
// por fase del latido, mismos parámetros que el simulador web).
// Solo se usa en ARDUINO_MODE=simulate para emular el sensor.
// ============================================================
const ONDAS = {
  P: [0.12, 0.15, 0.025],
  Q: [-0.15, 0.32, 0.01],
  R: [1.2, 0.35, 0.012],
  S: [-0.25, 0.38, 0.012],
  T: [0.25, 0.65, 0.045],
};

class EcgModel {
  constructor(fs = 250, bpmBase = 72) {
    this.fs = fs;
    this.bpmBase = bpmBase;
    this.fase = 0;
    this.t = 0;
    this.bpm = bpmBase;
    this.latido = false; // true en la muestra donde empieza un nuevo latido
  }

  gaussiano() {
    let u = Math.random();
    while (u === 0) u = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }

  /** Devuelve la siguiente muestra en mV. */
  siguiente() {
    this.t += 1 / this.fs;
    // El ritmo varía lentamente (±4 lpm cada 25 s) para que la demo se vea viva
    this.bpm = this.bpmBase + 4 * Math.sin((2 * Math.PI * this.t) / 25);
    this.fase += this.bpm / 60 / this.fs;
    this.latido = false;
    if (this.fase >= 1) {
      this.fase -= 1;
      this.latido = true;
    }
    let v = 0;
    for (const [a, c, s] of Object.values(ONDAS)) {
      const d = this.fase - c;
      v += a * Math.exp(-(d * d) / (2 * s * s));
    }
    return v + 0.02 * this.gaussiano() + 0.05 * Math.sin(2 * Math.PI * 0.2 * this.t);
  }
}

module.exports = EcgModel;
