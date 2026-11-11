// Pruebas del procesamiento de señales del navegador (no necesitan MySQL ni navegador):
//   - detector de QRS (Pan-Tompkins) y cálculo de BPM
//   - continuidad de fase del generador al mover el control de BPM
//   - respuesta en frecuencia de los filtros pasa-altas, pasa-bajas y notch
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const js = path.join(__dirname, '..', 'src', 'public', 'js');
const { ECGGenerator } = require(path.join(js, 'ecgGenerator.js'));
const { SignalProcessor } = require(path.join(js, 'signalProcessing.js'));

const FS = 250;

// Generador pseudoaleatorio con semilla (mulberry32): el ruido es siempre el mismo y la prueba no es intermitente
function conSemilla(semilla, funcion) {
    const original = Math.random;
    let a = semilla >>> 0;
    Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    try { return funcion(); } finally { Math.random = original; }
}

/** Simula `segundos` de señal y devuelve el BPM que reporta el detector. */
function medirBPM({ bpm, amplitud = 1, ruido = 10, red = false, deriva = false, segundos = 30 }) {
    return conSemilla(1234, () => {
        const gen = new ECGGenerator(FS);
        Object.assign(gen, { bpm, amplitude: amplitud, noiseLevel: ruido, enableHum: red, enableWander: deriva });
        const proc = new SignalProcessor(FS);
        for (let n = 0; n < segundos * FS; n++) proc.processSample(gen.nextSample(), n / FS);
        return proc.detectedBPM;
    });
}

test('el detector mide el BPM con ±2 lpm entre 40 y 180 lpm (señal normal)', () => {
    for (const bpm of [40, 50, 60, 75, 90, 100, 120, 150, 180]) {
        const medido = medirBPM({ bpm });
        assert.ok(Math.abs(medido - bpm) <= 2, `BPM real ${bpm}, medido ${medido}`);
    }
});

test('el detector tolera ruido gaussiano alto (30 %), red de 60 Hz y deriva de línea base (±3 lpm)', () => {
    for (const bpm of [60, 75, 100, 120]) {
        const medido = medirBPM({ bpm, ruido: 30, red: true, deriva: true });
        assert.ok(Math.abs(medido - bpm) <= 3, `BPM real ${bpm}, medido ${medido}`);
    }
});

test('el detector funciona con amplitudes de 0.5x a 2x', () => {
    for (const amplitud of [0.5, 1, 2]) {
        const medido = medirBPM({ bpm: 90, amplitud });
        assert.ok(Math.abs(medido - 90) <= 2, `amplitud ${amplitud}x → ${medido} lpm`);
    }
});

test('el BPM es null hasta que se miden al menos dos intervalos RR', () => {
    const gen = new ECGGenerator(FS);
    const proc = new SignalProcessor(FS);
    assert.equal(proc.detectedBPM, null);
    // En el primer segundo ni siquiera terminó la calibración del detector (2 s)
    for (let n = 0; n < FS; n++) proc.processSample(gen.nextSample(), n / FS);
    assert.equal(proc.detectedBPM, null);
});

test('resetDetector() borra la medición (se usa al cambiar de simulación a Arduino)', () => {
    const gen = new ECGGenerator(FS);
    const proc = new SignalProcessor(FS);
    for (let n = 0; n < 20 * FS; n++) proc.processSample(gen.nextSample(), n / FS);
    assert.notEqual(proc.detectedBPM, null);
    proc.resetDetector();
    assert.equal(proc.detectedBPM, null);
});

test('el detector se adapta cuando el BPM cambia de 60 a 120', () => {
    conSemilla(7, () => {
        const gen = new ECGGenerator(FS);
        const proc = new SignalProcessor(FS);
        gen.bpm = 60;
        let n = 0;
        for (; n < 15 * FS; n++) proc.processSample(gen.nextSample(), n / FS);
        assert.ok(Math.abs(proc.detectedBPM - 60) <= 2, `antes del cambio: ${proc.detectedBPM}`);
        gen.bpm = 120;
        for (; n < 30 * FS; n++) proc.processSample(gen.nextSample(), n / FS);
        assert.ok(Math.abs(proc.detectedBPM - 120) <= 2, `después del cambio: ${proc.detectedBPM}`);
    });
});

test('cambiar el BPM no produce saltos de fase en el generador', () => {
    const gen = new ECGGenerator(FS);
    gen.noiseLevel = 0;
    gen.nextSample();
    for (const bpm of [60, 150, 90, 180, 45, 75]) {
        gen.bpm = bpm;
        for (let i = 0; i < 100; i++) {
            const antes = gen.phase;
            gen.nextSample();
            let avance = gen.phase - antes;
            if (avance < 0) avance += 1;                       // la fase vuelve a 0 al terminar el latido
            assert.ok(Math.abs(avance - bpm / 60 / FS) < 1e-12, `a ${bpm} lpm la fase avanzó ${avance}`);
        }
    }
});

// ---------- Filtros del navegador: ganancia en régimen permanente ----------
function ganancia(frecuencia, configuracion) {
    const proc = new SignalProcessor(FS);
    Object.assign(proc, configuracion);
    const N = FS * 10;
    let maximo = 0;
    for (let n = 0; n < N; n++) {
        const y = proc.processSample(Math.sin((2 * Math.PI * frecuencia * n) / FS), n / FS);
        if (n > N / 2) maximo = Math.max(maximo, Math.abs(y));
    }
    return maximo;
}

test('filtro notch: elimina los 60 Hz y deja pasar el ECG (5 Hz)', () => {
    assert.ok(ganancia(60, { notchEnabled: true }) < 0.02);
    assert.ok(ganancia(5, { notchEnabled: true }) > 0.95);
});

test('filtro pasa-altas 0.5 Hz: atenúa la deriva de 0.15 Hz y conserva el ECG', () => {
    assert.ok(ganancia(0.15, { hpEnabled: true }) < 0.35);
    assert.ok(ganancia(5, { hpEnabled: true }) > 0.98);
});

test('filtro pasa-bajas 40 Hz: ganancia de −3 dB (0.707) en la frecuencia de corte', () => {
    const g = ganancia(40, { lpEnabled: true });
    assert.ok(Math.abs(g - Math.SQRT1_2) < 0.02, `ganancia en 40 Hz = ${g}`);
    assert.ok(ganancia(5, { lpEnabled: true }) > 0.98);
    assert.ok(ganancia(100, { lpEnabled: true }) < 0.5);
});

// ---------- Señales tipo AD8232 (casos que antes daban ~200 lpm) ----------
/** ECG con T configurable, ruido gaussiano, red de 60 Hz, deriva y ráfagas musculares; semilla fija. */
function ecgAD8232({ bpm = 75, T = 0.3, ruido = 0.03, red = 0.1, emg = 0, soloRuido = false, segundos = 30, semilla = 7 }) {
    let s = semilla >>> 0;
    const azar = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => { let u = azar(); while (u === 0) u = azar(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * azar()); };
    const ondas = [[0.15, -0.18, 0.025], [-0.12, -0.03, 0.01], [1, 0, 0.012], [-0.25, 0.03, 0.012], [T, 0.28, 0.045]];
    const latidos = [];
    for (let t = 0.3; t < segundos + 1; t += (60 / bpm) * (1 + 0.03 * gauss())) latidos.push(t);
    const x = [];
    let rafaga = 0;
    for (let i = 0; i < segundos * FS; i++) {
        const t = i / FS;
        let v = 0;
        if (!soloRuido) {
            for (const L of latidos) {
                const d0 = t - L;
                if (d0 < -0.4 || d0 > 0.6) continue;
                for (const [a, c, sg] of ondas) v += a * Math.exp(-((d0 - c) ** 2) / (2 * sg * sg));
            }
        }
        v += ruido * gauss() + red * Math.sin(2 * Math.PI * 60 * t) + 0.2 * Math.sin(2 * Math.PI * 0.2 * t);
        if (emg) { if (azar() < 0.002) rafaga = Math.round(0.6 * FS); if (rafaga > 0) { v += emg * gauss(); rafaga--; } }
        x.push(v);
    }
    return x;
}

/** Procesa la señal y devuelve los BPM mostrados cada segundo (después de 8 s) y la calidad final. */
function lecturas(x) {
    const proc = new SignalProcessor(FS);
    const bpm = [];
    x.forEach((v, n) => { proc.processSample(v, n / FS); if (n > 8 * FS && n % FS === 0) bpm.push(proc.detectedBPM); });
    return { bpm, calidad: proc.calidad };
}

test('onda T alta (0.8–1.0 mV): no se cuenta como latido, el BPM no se duplica', () => {
    for (const [bpm, T] of [[75, 0.8], [90, 1.0], [100, 0.7]]) {
        const { bpm: medidos } = lecturas(ecgAD8232({ bpm, T }));
        for (const m of medidos) assert.ok(m !== null && Math.abs(m - bpm) <= 3, `real ${bpm} con T=${T} → ${m}`);
    }
});

test('sin electrodos (solo ruido y red eléctrica) no inventa una frecuencia cardíaca', () => {
    for (const semilla of [1, 2, 3]) {
        const { bpm, calidad } = lecturas(ecgAD8232({ soloRuido: true, ruido: 0.3, red: 0.6, semilla }));
        assert.ok(bpm.every((b) => b === null), `semilla ${semilla}: mostró ${bpm.filter((b) => b !== null)}`);
        assert.ok(['ruido', 'irregular', 'sin-senal', 'calibrando'].includes(calidad), calidad);
    }
});

test('con ráfagas de ruido muscular nunca muestra un BPM equivocado (a lo sumo "--")', () => {
    const { bpm } = lecturas(ecgAD8232({ bpm: 80, T: 0.5, emg: 0.35 }));
    const mostrados = bpm.filter((b) => b !== null);
    assert.ok(mostrados.length > 0, 'debería medir en los tramos sin ruido');
    for (const b of mostrados) assert.ok(Math.abs(b - 80) <= 4, `mostró ${b} lpm con 80 reales`);
});

test('si la señal desaparece 3 s, el BPM vuelve a "--" con calidad "sin-senal"', () => {
    const x = ecgAD8232({ bpm: 70, segundos: 15 }).concat(new Array(5 * FS).fill(0));
    const proc = new SignalProcessor(FS);
    x.forEach((v, n) => proc.processSample(v, n / FS));
    assert.equal(proc.detectedBPM, null);
    assert.equal(proc.calidad, 'sin-senal');
});

test('diagnóstico: si casi toda la señal es la red de 60 Hz y no hay latidos, es "sin-contacto"', () => {
    // electrodos sin contacto: solo red de 60 Hz (~1 mV) y un poco de ruido, como en una captura real
    const sinContacto = ecgAD8232({ soloRuido: true, ruido: 0.05, red: 1.0, segundos: 15 });
    const proc = new SignalProcessor(FS);
    sinContacto.forEach((v, n) => proc.processSample(v, n / FS));
    assert.ok(proc.diagnostico.fraccionRed > 0.8, `fracción de red ${proc.diagnostico.fraccionRed}`);
    assert.equal(proc.detectedBPM, null);
    assert.equal(proc.diagnosticoSenal, 'sin-contacto');
});

test('un ECG real se mide aunque tenga 1 mV de interferencia de 60 Hz (no se confunde con "sin contacto")', () => {
    const { bpm } = lecturas(ecgAD8232({ bpm: 70, T: 0.4, red: 1.0 }));
    const mostrados = bpm.filter((b) => b !== null);
    assert.ok(mostrados.length >= bpm.length * 0.9, 'debería mostrar el BPM casi siempre');
    for (const b of mostrados) assert.ok(Math.abs(b - 70) <= 3, `mostró ${b} con 70 reales`);
});
