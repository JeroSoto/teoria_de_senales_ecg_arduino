// ============================================================
// Procesamiento digital de señales del navegador
//   1) Filtros que el usuario activa (pasa-altas, pasa-bajas, notch)
//   2) Detector de complejos QRS (algoritmo de Pan-Tompkins, 1985)
//      y cálculo de la frecuencia cardíaca a partir del intervalo RR
// ============================================================

/**
 * Filtro IIR de 2.º orden (biquad). Coeficientes del "Audio EQ Cookbook" (RBJ).
 *   y[n] = b0·x[n] + b1·x[n-1] + b2·x[n-2] - a1·y[n-1] - a2·y[n-2]
 * Con Q = 1/√2 la respuesta es de tipo Butterworth.
 */
class Biquad {
    constructor(type, f0, fs, Q = Math.SQRT1_2) {
        const w0 = (2 * Math.PI * f0) / fs;
        const cos = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * Q);
        let b0, b1, b2;
        if (type === 'highpass') {
            b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
        } else if (type === 'lowpass') {
            b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
        } else {
            throw new Error('Tipo de filtro no soportado: ' + type);
        }
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cos) / a0;
        this.a2 = (1 - alpha) / a0;
        this.x1 = this.x2 = this.y1 = this.y2 = 0;
    }

    /** Inicia el estado en régimen permanente para una entrada constante x (evita el transitorio inicial). */
    prime(x) {
        const gananciaDC = (this.b0 + this.b1 + this.b2) / (1 + this.a1 + this.a2);
        this.x1 = this.x2 = x;
        this.y1 = this.y2 = gananciaDC * x;
    }

    process(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x;
        this.y2 = this.y1; this.y1 = y;
        return y;
    }
}

/**
 * Detector de QRS (Pan-Tompkins):
 *   1) pasa-banda 5–15 Hz (pasa-altas + pasa-bajas)   2) derivada de 5 puntos
 *   3) elevación al cuadrado                          4) integración en ventana móvil de 150 ms
 *   5) umbral adaptativo entre el nivel de señal (SPK) y el de ruido (NPK)
 * process(x) devuelve el índice de muestra del pico R detectado o null.
 */
class QRSDetector {
    constructor(fs) {
        this.fs = fs;
        this.hp = new Biquad('highpass', 5, fs);
        this.lp = new Biquad('lowpass', 15, fs);
        this.ventana = Math.max(2, Math.round(0.15 * fs));
        this.buf = new Float64Array(this.ventana);
        this.suma = 0;
        this.pos = 0;
        this.h = [0, 0, 0, 0];            // salida del pasa-banda en n-1 … n-4
        this.n = 0;                       // contador de muestras
        this.i1 = 0;                      // señal integrada en n-1
        this.i2 = 0;                      // señal integrada en n-2
        this.spk = 0;                     // nivel estimado de picos QRS
        this.npk = 0;                     // nivel estimado de picos de ruido
        this.umbral = Infinity;
        this.calentamiento = Math.round(2 * fs);   // 2 s para calibrar los niveles
        this.maxCalentamiento = 0;
        this.refractario = Math.round(0.25 * fs);  // 250 ms: no hay dos QRS tan seguidos
        this.ultimaDeteccion = -Infinity;           // muestra en la que se tomó la última decisión de latido
        this.busqueda = Math.max(2, Math.round(0.2 * fs));   // se busca el pico R en los 200 ms previos a la decisión
        this.absBanda = new Float64Array(this.busqueda);     // |señal pasa-banda| de las últimas muestras
        this.decaimiento = Math.pow(0.6, 1 / fs);  // los niveles bajan 40 % por segundo sin latidos
        this.iniciado = false;
    }

    process(x) {
        if (!this.iniciado) {
            this.hp.prime(x);
            this.lp.prime(0);
            this.iniciado = true;
        }
        // 1) pasa-banda 5–15 Hz
        const b = this.lp.process(this.hp.process(x));
        this.absBanda[this.n % this.busqueda] = Math.abs(b);
        // 2) derivada: y[n] = (2x[n] + x[n-1] - x[n-3] - 2x[n-4]) / 8
        const d = (2 * b + this.h[0] - this.h[2] - 2 * this.h[3]) / 8;
        this.h = [b, this.h[0], this.h[1], this.h[2]];
        // 3) cuadrado
        const cuadrado = d * d;
        // 4) integración en ventana móvil
        this.suma += cuadrado - this.buf[this.pos];
        this.buf[this.pos] = cuadrado;
        this.pos = (this.pos + 1) % this.ventana;
        const integrada = Math.max(0, this.suma / this.ventana);

        // 5) decisión: ¿la señal integrada tuvo un máximo local en la muestra anterior?
        let latido = null;
        if (this.n >= 2 && this.i1 > this.i2 && this.i1 >= integrada) {
            const pico = this.i1;
            const idx = this.n - 1;
            if (this.n < this.calentamiento) {
                this.maxCalentamiento = Math.max(this.maxCalentamiento, pico);
            } else if (pico > this.umbral && idx - this.ultimaDeteccion > this.refractario) {
                this.spk = 0.125 * pico + 0.875 * this.spk;
                this.ultimaDeteccion = idx;
                // La señal integrada tiene una meseta de ~150 ms: su máximo "baila" de un latido a otro.
                // Por eso se ubica el pico R como el máximo de |pasa-banda| en los 200 ms previos,
                // y los intervalos RR salen casi sin jitter.
                let mejor = -1;
                for (let j = 0; j < this.busqueda; j++) {
                    const v = this.absBanda[(this.n - j) % this.busqueda];
                    if (v > mejor) { mejor = v; latido = this.n - j; }
                }
            } else if (pico <= this.umbral) {
                this.npk = 0.125 * pico + 0.875 * this.npk;
            }
            this.umbral = this.npk + 0.25 * (this.spk - this.npk);
        }

        if (this.n === this.calentamiento) {
            this.spk = 0.5 * this.maxCalentamiento;
            this.npk = 0.05 * this.maxCalentamiento;
            this.umbral = this.npk + 0.25 * (this.spk - this.npk);
        }
        // Si pasan más de 2 s sin latidos (por ejemplo, la amplitud bajó mucho) los niveles se reajustan
        if (this.n > this.calentamiento && this.n - this.ultimaDeteccion > 2 * this.fs) {
            this.spk *= this.decaimiento;
            this.npk *= this.decaimiento;
            this.umbral = this.npk + 0.25 * (this.spk - this.npk);
        }

        this.i2 = this.i1;
        this.i1 = integrada;
        this.n++;
        return latido;
    }
}

class SignalProcessor {
    constructor(sampleRate = 250) {
        this.fs = sampleRate;

        this.hpEnabled = false;
        this.hpXPrev = 0;
        this.hpYPrev = 0;

        this.lpEnabled = false;
        this.lpYPrev = 0;

        this.notchEnabled = false;
        this.nBuffer = [0, 0];
        this.nYBuffer = [0, 0];

        this.resetDetector();
    }

    /** Reinicia el detector de latidos (al cambiar de fuente o de frecuencia de muestreo). */
    resetDetector() {
        this.qrs = new QRSDetector(this.fs);
        this.ultimoLatidoIdx = null;
        this.intervalosRR = [];
        this.detectedBPM = null;      // null hasta que se midan al menos dos intervalos RR
    }

    processSample(sample, currentTime) {
        // La detección usa la señal sin filtrar por el usuario: así no depende de qué botones estén activos.
        // Con menos de 100 Hz (p. ej. el formato del Serial Plotter, 40 puntos/s) el pasa-banda de 5–15 Hz
        // no cabe bajo Nyquist: en ese caso se usa la frecuencia cardíaca que calcula el Arduino.
        if (this.fs >= 100) this.detectRPeak(sample);
        else this.detectedBPM = null;

        let output = sample;

        if (this.hpEnabled) {
            const fc = 0.5;
            const rc = 1.0 / (2 * Math.PI * fc);
            const dt = 1.0 / this.fs;
            const alpha = rc / (rc + dt);

            const y = alpha * (this.hpYPrev + output - this.hpXPrev);
            this.hpXPrev = output;
            this.hpYPrev = y;
            output = y;
        }

        if (this.lpEnabled) {
            // IIR de 1.er orden: y[n] = y[n-1] + α(x[n] - y[n-1]).
            // α se calcula para que la ganancia valga exactamente 1/√2 (−3 dB) en fc.
            // (La aproximación α = ωTs/(1+ωTs) solo sirve si fc << fs; aquí daría un corte real de ≈ 29 Hz.)
            const fc = 40;
            const c = Math.cos(2 * Math.PI * fc / this.fs);
            const alpha = -(1 - c) + Math.sqrt((1 - c) * (1 - c) + 2 * (1 - c));

            const y = this.lpYPrev + alpha * (output - this.lpYPrev);
            this.lpYPrev = y;
            output = y;
        }

        if (this.notchEnabled) {
            output = this.applyNotch60Hz(output);
        }

        return output;
    }

    applyNotch60Hz(x) {
        const w0 = 2 * Math.PI * 60 / this.fs;
        const r = 0.95;
        const b0 = 1, b1 = -2 * Math.cos(w0), b2 = 1;
        const a1 = -2 * r * Math.cos(w0), a2 = r * r;

        const y = b0 * x + b1 * this.nBuffer[0] + b2 * this.nBuffer[1]
                       - a1 * this.nYBuffer[0] - a2 * this.nYBuffer[1];

        this.nBuffer[1] = this.nBuffer[0];
        this.nBuffer[0] = x;
        this.nYBuffer[1] = this.nYBuffer[0];
        this.nYBuffer[0] = y;

        return y;
    }

    detectRPeak(sample) {
        if (this.qrs.fs !== this.fs) this.resetDetector();   // cambió la frecuencia de muestreo

        const idx = this.qrs.process(sample);
        if (idx === null) return;

        if (this.ultimoLatidoIdx !== null) {
            const rr = (idx - this.ultimoLatidoIdx) / this.fs;   // intervalo RR en segundos
            if (rr >= 0.27 && rr <= 2.0) {                        // 30–220 lpm
                this.intervalosRR.push(rr);
                if (this.intervalosRR.length > 5) this.intervalosRR.shift();
                if (this.intervalosRR.length >= 2) {
                    // La mediana de los últimos RR descarta un latido perdido o uno falso
                    const orden = [...this.intervalosRR].sort((a, b) => a - b);
                    const mediana = orden[Math.floor(orden.length / 2)];
                    this.detectedBPM = Math.round(60 / mediana);  // BPM = 60 / RR
                }
            }
        }
        this.ultimoLatidoIdx = idx;
    }
}

// Permite probar estas clases con Node.js (npm test); en el navegador no hace nada
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Biquad, QRSDetector, SignalProcessor };
}
