document.addEventListener('DOMContentLoaded', () => {
    const fs = 250;
    const generator = new ECGGenerator(fs);
    const processor = new SignalProcessor(fs);
    const renderer = new ECGRenderer('ecgCanvas');

    let isRunning = true;
    let currentTime = 0;

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
    let lastBpm = 75;
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

    const intervalMs = 1000 / fs;

    setInterval(() => {
        if (!isRunning) return;

        // ¿La señal viene del Arduino (vía servidor) o del generador simulado?
        const arduinoOn = !!(window.ArduinoLink && ArduinoLink.active);
        if (arduinoOn !== lastArduinoOn) {
            lastArduinoOn = arduinoOn;
            signalHeading.textContent = arduinoOn
                ? 'ECG real · Arduino AD8232'
                : 'ECG simulado · fs = 250 Hz';
            statusIndicator.textContent = arduinoOn ? 'ARDUINO' : 'SIMULACIÓN';
        }

        if (arduinoOn) {
            // El ritmo lo marca el Arduino: se procesan todas las muestras recibidas
            processor.fs = ArduinoLink.fs || fs;
            for (const rawSample of ArduinoLink.drain()) {
                currentTime += 1 / processor.fs;
                renderer.addSample(processor.processSample(rawSample, currentTime));
            }
        } else {
            processor.fs = fs;
            currentTime += 1 / fs;

            const rawSample = generator.nextSample();
            const processedSample = processor.processSample(rawSample, currentTime);

            renderer.addSample(processedSample);
        }
        renderer.render();

        const arduinoBpm = arduinoOn && ArduinoLink.bpm ? ArduinoLink.bpm : null;
        const currentBPM = arduinoBpm !== null ? arduinoBpm : processor.detectedBPM;
        lastBpm = currentBPM;
        lastSource = arduinoOn ? 'arduino' : 'simulado';
        bpmDisplay.textContent = currentBPM;

        const freqHz = (currentBPM / 60).toFixed(2);
        freqDisplay.textContent = freqHz;

        const rrSec = (60 / currentBPM).toFixed(2);
        rrDisplay.textContent = rrSec;

    }, intervalMs);
});
