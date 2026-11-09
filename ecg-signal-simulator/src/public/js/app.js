document.addEventListener('DOMContentLoaded', () => {
    const fs = 250;
    const generator = new ECGGenerator(fs);
    const processor = new SignalProcessor(fs);
    const renderer = new ECGRenderer('ecgCanvas');

    let isRunning = true;
    let currentTime = 0;
    let lastMetricsUpdate = 0;

    // Bucle de tiempo real: se generan tantas muestras como indique el reloj (no una por "tick").
    // Así la señal avanza a fs = 250 muestras/s aunque el navegador espere más de 4 ms entre ciclos
    // (setInterval se limita a ≥ 4 ms, y a 1 s en pestañas en segundo plano, sobre todo en celulares).
    const MAX_CATCHUP_S = 0.25;   // si la pestaña estuvo detenida, no se "recupera" más de 250 ms de señal
    let lastFrame = null;
    let sampleDebt = 0;           // muestras pendientes de generar (parte fraccionaria incluida)

    const bpmSlider = document.getElementById('bpmSlider');
    const bpmVal = document.getElementById('bpmVal');
    const ampSlider = document.getElementById('ampSlider');
    const ampVal = document.getElementById('ampVal');
    const noiseSlider = document.getElementById('noiseSlider');
    const noiseVal = document.getElementById('noiseVal');

    const humCheck = document.getElementById('humCheck');
    const wanderCheck = document.getElementById('wanderCheck');

    const btnHP = document.getElementById('btnHighPass');
    const btnLP = document.getElementById('btnLowPass');
    const btnNotch = document.getElementById('btnNotch');
    const btnPlay = document.getElementById('btnTogglePlay');
    const bpmDisplay = document.getElementById('bpmDisplay');
    const freqDisplay = document.getElementById('freqDisplay');
    const rrDisplay = document.getElementById('rrDisplay');
    const filterStatus = document.getElementById('filterStatus');
    const signalHeading = document.getElementById('signalHeading');
    const statusIndicator = document.getElementById('text-status');

    let lastArduinoOn = false;
    let lastBpm = null;          // null = aún no hay una medición válida
    let lastSource = 'simulado';

    // Permite que el historial (history.js) consulte la lectura actual
    window.ECGApp = { getState: () => ({ bpm: lastBpm, fuente: lastSource }) };

    bpmSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        generator.bpm = val;
        bpmVal.textContent = val;
    });

    ampSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        generator.amplitude = val;
        ampVal.textContent = val.toFixed(1) + 'x';
    });

    noiseSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        generator.noiseLevel = val;
        noiseVal.textContent = val + '%';
    });

    humCheck.addEventListener('change', (e) => {
        generator.enableHum = e.target.checked;
    });

    wanderCheck.addEventListener('change', (e) => {
        generator.enableWander = e.target.checked;
    });

    btnHP.addEventListener('click', () => {
        processor.hpEnabled = !processor.hpEnabled;
        btnHP.classList.toggle('active', processor.hpEnabled);
        updateFilterLabel();
    });

    btnLP.addEventListener('click', () => {
        processor.lpEnabled = !processor.lpEnabled;
        btnLP.classList.toggle('active', processor.lpEnabled);
        updateFilterLabel();
    });

    btnNotch.addEventListener('click', () => {
        processor.notchEnabled = !processor.notchEnabled;
        btnNotch.classList.toggle('active', processor.notchEnabled);
        updateFilterLabel();
    });

    btnPlay.addEventListener('click', () => {
        isRunning = !isRunning;
        btnPlay.textContent = isRunning ? "Pausar / Reanudar" : "Reanudar Simulación";
    });

    function updateFilterLabel() {
        const active = [];
        if (processor.hpEnabled) active.push('HP');
        if (processor.lpEnabled) active.push('LP');
        if (processor.notchEnabled) active.push('NOTCH');

        filterStatus.textContent = active.length > 0 ? active.join(' + ') : 'INACTIVOS';
    }

    // Muestra un valor numérico o "--" mientras todavía no hay medición
    const mostrar = (valor, decimales = 0) => (valor === null || !Number.isFinite(valor) ? '--' : valor.toFixed(decimales));

    function ciclo(ahora) {
        requestAnimationFrame(ciclo);

        // El reloj avanza siempre, incluso en pausa, para no generar una ráfaga de muestras al reanudar
        const dt = lastFrame === null ? 0 : Math.min((ahora - lastFrame) / 1000, MAX_CATCHUP_S);
        lastFrame = ahora;
        if (!isRunning) return;

        // ¿La señal viene del Arduino (vía servidor) o del generador simulado?
        // ArduinoLink es un "const" de otro script: no cuelga de window, por eso se consulta con typeof
        const arduinoOn = typeof ArduinoLink !== 'undefined' && ArduinoLink.active;
        if (arduinoOn !== lastArduinoOn) {
            lastArduinoOn = arduinoOn;
            signalHeading.textContent = arduinoOn
                ? 'ECG real · Arduino AD8232'
                : 'ECG simulado · fs = 250 Hz';
            statusIndicator.textContent = arduinoOn ? 'ARDUINO' : 'SIMULACIÓN';
            processor.resetDetector();     // otra señal → el detector debe recalibrarse
            sampleDebt = 0;
        }

        let hasNewSamples = false;
        if (arduinoOn) {
            // El ritmo lo marca el Arduino: se procesan todas las muestras recibidas
            processor.fs = ArduinoLink.fs || fs;
            for (const rawSample of ArduinoLink.drain()) {
                currentTime += 1 / processor.fs;
                renderer.addSample(processor.processSample(rawSample, currentTime));
                hasNewSamples = true;
            }
        } else {
            processor.fs = fs;
            sampleDebt += dt * fs;
            while (sampleDebt >= 1) {
                sampleDebt -= 1;
                currentTime += 1 / fs;
                const rawSample = generator.nextSample();
                renderer.addSample(processor.processSample(rawSample, currentTime));
                hasNewSamples = true;
            }
        }
        if (hasNewSamples) renderer.render();

        const arduinoBpm = arduinoOn && ArduinoLink.bpm ? ArduinoLink.bpm : null;
        const currentBPM = arduinoBpm !== null ? arduinoBpm : processor.detectedBPM;
        lastBpm = currentBPM;
        lastSource = arduinoOn ? 'arduino' : 'simulado';

        if (ahora - lastMetricsUpdate >= 250) {
            lastMetricsUpdate = ahora;
            bpmDisplay.textContent = mostrar(currentBPM);
            freqDisplay.textContent = currentBPM ? mostrar(currentBPM / 60, 2) : '--';
            rrDisplay.textContent = currentBPM ? mostrar(60 / currentBPM, 2) : '--';
        }
    }

    renderer.render();               // dibuja la cuadrícula desde el primer instante
    requestAnimationFrame(ciclo);
});
