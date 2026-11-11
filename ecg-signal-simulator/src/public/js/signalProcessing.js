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
        } else if (type === 'notch') {
            b0 = 1; b1 = -2 * cos; b2 = 1;
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
 * Detector de QRS (Pan-Tompkins, 1985):
 *   0) notch de 60 Hz (red eléctrica)
 *   1) pasa-banda 5–15 Hz (pasa-altas + pasa-bajas)   2) derivada de 5 puntos
 *   3) elevación al cuadrado                          4) integración en ventana móvil de 150 ms
 *   5) umbral adaptativo entre el nivel de señal (SPK) y el de ruido (NPK)
 *   6) período refractario de 200 ms y discriminación de la onda T: un pico entre 200 y 360 ms
 *      después del QRS con menos de la mitad de su PENDIENTE máxima es la onda T (la T puede ser
 *      alta, pero siempre es mucho menos empinada que el QRS)
 *   7) búsqueda hacia atrás: si pasa 1.66 × RR sin latido, se acepta el mejor pico que quedó
 *      por debajo del umbral (con un umbral a la mitad)
 * process(x) devuelve el índice de muestra del pico R detectado o null.
 */
class QRSDetector {
    constructor(fs) {
        this.fs = fs;
        this.notch = fs > 130 ? new Biquad('notch', 60, fs, 5) : null;
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
        this.refractario = Math.round(0.2 * fs);   // 200 ms: período refractario absoluto del corazón
        this.ventanaT = Math.round(0.36 * fs);     // 360 ms: hasta aquí un pico puede ser la onda T
        this.ultimaDeteccion = -Infinity;           // muestra del último pico R aceptado
        this.ampQRS = 0;                            // pendiente máxima típica de los QRS recientes
        this.rrDetector = [];                       // últimos RR (en muestras) para la búsqueda hacia atrás
        this.rrPromedio = 0;
        this.candidato = null;                      // mejor pico bajo el umbral desde el último QRS
        this.busqueda = Math.max(2, Math.round(0.2 * fs));   // se busca el pico R en los 200 ms previos a la decisión
        this.pendienteAbs = new Float64Array(this.busqueda); // |derivada del pasa-banda| de las últimas muestras
        this.decaimiento = Math.pow(0.6, 1 / fs);  // los niveles bajan 40 % por segundo sin latidos
        this.iniciado = false;
    }

    /** Acepta un QRS: actualiza niveles, RR del detector y amplitud típica. */
    registrar(r, pico, amp, peso) {
        this.spk = peso * pico + (1 - peso) * this.spk;
        if (Number.isFinite(this.ultimaDeteccion)) {
            this.rrDetector.push(r - this.ultimaDeteccion);
            if (this.rrDetector.length > 8) this.rrDetector.shift();
            this.rrPromedio = this.rrDetector.reduce((s, v) => s + v, 0) / this.rrDetector.length;
        }
        this.ultimaDeteccion = r;
        this.ampQRS = this.ampQRS ? 0.7 * this.ampQRS + 0.3 * amp : amp;
        this.candidato = null;
        return r;
    }

    process(x) {
        if (!this.iniciado) {
            if (this.notch) this.notch.prime(x);
            this.hp.prime(x);
            this.lp.prime(0);
            this.iniciado = true;
        }
        // 0) notch de 60 Hz y 1) pasa-banda 5–15 Hz
        const v = this.notch ? this.notch.process(x) : x;
        const b = this.lp.process(this.hp.process(v));
        // 2) derivada: y[n] = (2x[n] + x[n-1] - x[n-3] - 2x[n-4]) / 8
        const d = (2 * b + this.h[0] - this.h[2] - 2 * this.h[3]) / 8;
        this.h = [b, this.h[0], this.h[1], this.h[2]];
        this.pendienteAbs[this.n % this.busqueda] = Math.abs(d);
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
            if (this.n < this.calentamiento) {
                this.maxCalentamiento = Math.max(this.maxCalentamiento, pico);
            } else {
                // La señal integrada tiene una meseta de ~150 ms: su máximo "baila" de un latido a otro.
                // Por eso el latido se ubica en la pendiente máxima (el flanco más empinado del QRS) dentro
                // de los 200 ms previos: los intervalos RR salen casi sin jitter. Esa pendiente es también
                // la que se compara para distinguir el QRS de la onda T.
                let r = this.n - 1;
                let amp = -1;
                for (let j = 0; j < this.busqueda; j++) {
                    const a = this.pendienteAbs[(this.n - j) % this.busqueda];
                    if (a > amp) { amp = a; r = this.n - j; }
                }
                const dt = r - this.ultimaDeteccion;
                if (pico > this.umbral) {
                    if (dt <= this.refractario) {
                        // mismo complejo QRS (o ruido pegado a él): se ignora
                    } else if (dt < this.ventanaT && amp < 0.5 * this.ampQRS) {
                        this.npk = 0.125 * pico + 0.875 * this.npk;   // 6) es la onda T, no un latido
                    } else {
                        latido = this.registrar(r, pico, amp, 0.125);
                    }
                } else {
                    this.npk = 0.125 * pico + 0.875 * this.npk;
                    if (dt > this.ventanaT && (!this.candidato || pico > this.candidato.pico)) {
                        this.candidato = { pico, r, amp };
                    }
                }
                this.umbral = this.npk + 0.25 * (this.spk - this.npk);
            }
        }

        if (this.n < this.calentamiento) this.sumaCalentamiento = (this.sumaCalentamiento || 0) + integrada;
        if (this.n === this.calentamiento) {
            // Como en Pan-Tompkins: señal = mitad del máximo; ruido = mitad del promedio de la señal integrada.
            // Con un ECG el promedio es pequeño frente al pico del QRS; con solo ruido, los dos se parecen.
            this.spk = 0.5 * this.maxCalentamiento;
            this.npk = Math.max(0.05 * this.maxCalentamiento, 0.5 * (this.sumaCalentamiento / this.calentamiento));
            this.umbral = this.npk + 0.25 * (this.spk - this.npk);
        }
        if (this.n > this.calentamiento) {
            const sinLatido = this.n - this.ultimaDeteccion;
            // 7) búsqueda hacia atrás de un latido que quedó bajo el umbral
            if (latido === null && this.rrPromedio > 0 && this.candidato && sinLatido > 1.66 * this.rrPromedio
                && this.candidato.pico > 0.5 * this.umbral) {
                const c = this.candidato;
                latido = this.registrar(c.r, c.pico, c.amp, 0.25);
                this.umbral = this.npk + 0.25 * (this.spk - this.npk);
            }
            // Si pasan más de 2 s sin latidos (por ejemplo, la amplitud bajó mucho) los niveles se reajustan
            if (sinLatido > 2 * this.fs) {
                this.spk *= this.decaimiento;
                this.npk *= this.decaimiento;
                this.umbral = this.npk + 0.25 * (this.spk - this.npk);
            }
        }

        this.i2 = this.i1;
        this.i1 = integrada;
        this.n++;
        return latido;
    }
}

/** Mediana de una lista (para listas pares devuelve el valor central superior). */
function mediana(lista) {
    const orden = [...lista].sort((a, b) => a - b);
    return orden[Math.floor(orden.length / 2)];
}

/**
 * Diagnóstico de la señal: ¿qué parte de la potencia es interferencia de la red (60 Hz)?
 * Se compara la señal (sin la continua) con la misma señal pasada por un notch de 60 Hz.
 * Promedios exponenciales de ~2 s. Con los electrodos sin contacto el AD8232 solo capta
 * la red eléctrica: más del 80 % de la potencia queda en 60 Hz y no hay latidos.
 * También detecta la saturación: si la salida del AD8232 queda clavada en 0 V o en 3.3 V
 * (la señal no cambia durante ≥ 0.5 s), el amplificador está saturado. Un ECG nunca está
 * quieto tanto tiempo (ondas P y T, ruido). Suele faltar el electrodo RL o uno no hace contacto.
 */
class DiagnosticoSenal {
    constructor(fs) {
        this.fs = fs;
        this.hp = new Biquad('highpass', 0.5, fs);
        this.notch = new Biquad('notch', 60, fs, 5);
        this.alfa = 1 - Math.exp(-1 / (2 * fs));   // constante de tiempo de 2 s
        this.potTotal = 0;
        this.potRed = 0;
        this.n = 0;
        this.anterior = 0;
        this.corridaPlana = 0;            // muestras seguidas sin cambio (< 0.01 mV ≈ 2 cuentas del ADC)
        this.ultimaSaturacion = -Infinity;
    }

    process(x) {
        if (this.n === 0) { this.hp.prime(x); this.notch.prime(0); }
        const sinContinua = this.hp.process(x);
        const sinRed = this.notch.process(sinContinua);
        const red = sinContinua - sinRed;
        this.potTotal += this.alfa * (sinContinua * sinContinua - this.potTotal);
        this.potRed += this.alfa * (red * red - this.potRed);
        this.corridaPlana = this.n > 0 && Math.abs(x - this.anterior) < 0.01 ? this.corridaPlana + 1 : 0;
        if (this.corridaPlana >= 0.5 * this.fs) this.ultimaSaturacion = this.n;
        this.anterior = x;
        this.n++;
    }

    /** true si en los últimos 2 s la salida estuvo clavada (amplificador saturado) */
    get saturada() {
        return this.n - this.ultimaSaturacion < 2 * this.fs;
    }

    /** Fracción de la potencia que es red eléctrica (0–1); null mientras se calibra (3 s). */
    get fraccionRed() {
        if (this.n < 3 * this.fs || this.potTotal <= 0) return null;
        return this.potRed / this.potTotal;
    }

    /** Amplitud de la interferencia de 60 Hz en mV (pico). */
    get amplitudRed() {
        return Math.sqrt(2 * this.potRed);
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
        this.detectedBPM = null;      // null hasta tener 4 intervalos RR coherentes
        this.ultimoValido = -Infinity;
        this.rapidas = [];            // últimas 8 detecciones: true si llegó a menos de 300 ms de la anterior
        // 'calibrando' | 'buena' | 'ruido' (señal/ruido baja o interferencia) | 'irregular' (RR dispersos) | 'sin-senal' (no hay latidos)
        this.calidad = 'calibrando';
        this.diagnostico = this.fs > 130 ? new DiagnosticoSenal(this.fs) : null;
    }

    /**
     * Resumen para el usuario: 'sin-contacto' si casi toda la señal es la red de 60 Hz y no hay
     * latidos (electrodos sin contacto o cable desconectado); si no, la calidad del detector.
     */
    get diagnosticoSenal() {
        const sinMedicion = this.detectedBPM === null && this.calidad !== 'buena';
        if (sinMedicion && this.diagnostico && this.diagnostico.saturada) return 'saturado';
        const red = this.diagnostico ? this.diagnostico.fraccionRed : null;
        if (sinMedicion && red !== null && red > 0.8) return 'sin-contacto';
        return this.calidad;
    }

    processSample(sample, currentTime) {
        // La detección usa la señal sin filtrar por el usuario: así no depende de qué botones estén activos.
        // Con menos de 100 Hz (p. ej. el formato del Serial Plotter de un sketch antiguo, 25–40 puntos/s)
        // el pasa-banda de 5–15 Hz no cabe bajo Nyquist: no se calcula un BPM (se muestra "--").
        if (this.fs >= 100) {
            this.detectRPeak(sample);
            if (this.diagnostico) this.diagnostico.process(sample);
        } else {
            this.detectedBPM = null;
        }

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
        if (idx !== null) this.registrarLatido(idx);

        // 3 s sin latidos: no hay señal cardíaca (electrodos sueltos o sin contacto)
        const ahora = this.qrs.n;
        if (this.ultimoLatidoIdx !== null && ahora - this.ultimoLatidoIdx > 3 * this.fs && this.calidad !== 'sin-senal') {
            this.intervalosRR = [];
            this.detectedBPM = null;
            this.calidad = 'sin-senal';
        }
    }

    registrarLatido(idx) {
        if (this.ultimoLatidoIdx === null) { this.ultimoLatidoIdx = idx; return; }
        const rr = (idx - this.ultimoLatidoIdx) / this.fs;   // intervalo RR en segundos
        // Menos de 300 ms (más de 200 lpm) no es un latido real en reposo: suele ser la onda T,
        // un movimiento o interferencia. Se descarta y se sigue midiendo desde el último latido válido,
        // pero se anota: si se repite, la señal está contaminada (ver más abajo).
        this.rapidas.push(rr < 0.3);
        if (this.rapidas.length > 8) this.rapidas.shift();
        if (rr < 0.3) return;
        this.ultimoLatidoIdx = idx;
        if (rr > 2.0) { this.intervalosRR = []; return; }   // pausa o pérdida de señal: se empieza de nuevo
        this.intervalosRR.push(rr);
        if (this.intervalosRR.length > 8) this.intervalosRR.shift();
        if (this.intervalosRR.length < 4) { this.calidad = 'calibrando'; return; }

        // BPM = 60 / RR con la mediana de los últimos 8 intervalos: un latido falso o perdido no la mueve.
        // Solo se muestra si la señal es confiable:
        //   · relación señal/ruido: el nivel de los QRS (SPK) debe ser ≥ 3 veces el del ruido (NPK).
        //     Con un ECG real es de 8 a 30; sin electrodos (solo ruido) ronda 2.
        //   · ritmo coherente: al menos 3 de cada 4 intervalos RR (6 de 8) a ±15 % de la mediana.
        //     Un latido real pasa de sobra; el ruido muscular o de movimiento mete RR al azar y no.
        //   · sin "latidos" imposibles: si 2 de las últimas 8 detecciones llegaron a menos de 300 ms,
        //     hay una interferencia periódica (p. ej. cada 0.26 s ≈ 230/min). Sin esta regla se
        //     descartaría uno de cada dos picos y saldría un ritmo "regular" falso (~115 lpm).
        // Así el ruido no produce BPM inventados (antes, sin electrodos, salían 150–200 lpm).
        const med = mediana(this.intervalosRR);
        const coherentes = this.intervalosRR.filter((v) => Math.abs(v - med) <= 0.15 * med).length;
        const senalRuido = this.qrs.spk / Math.max(1e-12, this.qrs.npk);
        const interferencia = this.rapidas.filter(Boolean).length >= 2;
        if (senalRuido >= 3 && !interferencia && coherentes * 4 >= this.intervalosRR.length * 3) {
            this.detectedBPM = Math.round(60 / med);
            this.calidad = 'buena';
            this.ultimoValido = idx;
        } else {
            this.calidad = senalRuido < 3 || interferencia ? 'ruido' : 'irregular';
            if (idx - this.ultimoValido > 3 * this.fs) this.detectedBPM = null;   // conserva el último valor 3 s
        }
    }
}

// Permite probar estas clases con Node.js (npm test); en el navegador no hace nada
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Biquad, QRSDetector, SignalProcessor, DiagnosticoSenal, mediana };
}
