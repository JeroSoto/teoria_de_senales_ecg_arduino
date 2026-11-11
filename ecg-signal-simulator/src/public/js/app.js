document.addEventListener('DOMContentLoaded', () => {
    const fs = 250;
    const generator = new ECGGenerator(fs);
    const processor = new SignalProcessor(fs);
    const renderer = new ECGRenderer('ecgCanvas', { fs });

    let isRunning = true;
    let currentTime = 0;
    let lastMetricsUpdate = 0;

    // Bucle de tiempo real: se generan tantas muestras como indique el reloj (no una por "tick").
    // Así la señal avanza a fs = 250 muestras/s aunque el navegador espere más de 4 ms entre ciclos
    // (setInterval se limita a ≥ 4 ms, y a 1 s en pestañas en segundo plano, sobre todo en celulares).
    const MAX_CATCHUP_S = 0.25;   // si la pestaña estuvo detenida, no se "recupera" más de 250 ms de señal
    let lastFrame = null;
    let sampleDebt = 0;           // muestras pendientes de generar (parte fraccionaria incluida)

    const $ = (id) => document.getElementById(id);
    const bpmSlider = $('bpmSlider');
    const bpmVal = $('bpmVal');
    const ampSlider = $('ampSlider');
    const ampVal = $('ampVal');
    const noiseSlider = $('noiseSlider');
    const noiseVal = $('noiseVal');
    const humCheck = $('humCheck');
    const wanderCheck = $('wanderCheck');
    const btnHP = $('btnHighPass');
    const btnLP = $('btnLowPass');
    const btnNotch = $('btnNotch');
    const btnPlay = $('btnTogglePlay');
    const bpmDisplay = $('bpmDisplay');
    const freqDisplay = $('freqDisplay');
    const rrDisplay = $('rrDisplay');
    const filterStatus = $('filterStatus');
    const signalHeading = $('signalHeading');
    const statusPill = $('statusPill');
    const statusText = $('text-status');
    const signalNotice = $('signalNotice');
    const simControls = $('simulationControls');
    const AVISO_SIMULACION = signalNotice.textContent.trim();

    let lastSource = null;        // objeto de la fuente activa (UsbSerial, ArduinoLink) o null = simulación
    let lastBpm = null;           // null = aún no hay una medición válida
    let lastSourceName = 'simulado';

    // Permite que el historial (history.js) consulte la lectura actual
    window.ECGApp = { getState: () => ({ bpm: lastBpm, fuente: lastSourceName }) };

    bpmSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        generator.bpm = val;
        bpmVal.textContent = val;
    });
    ampSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        generator.amplitude = val;
        ampVal.textContent = val.toFixed(1) + 'x';
    });
    noiseSlider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        generator.noiseLevel = val;
        noiseVal.textContent = val + '%';
    });
    humCheck.addEventListener('change', (e) => { generator.enableHum = e.target.checked; });
    wanderCheck.addEventListener('change', (e) => { generator.enableWander = e.target.checked; });

    const FILTROS = [[btnHP, 'hpEnabled'], [btnNotch, 'notchEnabled'], [btnLP, 'lpEnabled']];
    const fijarFiltro = (btn, key, activo) => {
        processor[key] = activo;
        btn.classList.toggle('active', activo);
        btn.setAttribute('aria-pressed', String(activo));
    };
    const toggleFilter = (btn, key) => {
        fijarFiltro(btn, key, !processor[key]);
        updateFilterLabel();
    };
    // Con el Arduino los tres filtros se encienden solos: la señal cruda del AD8232 trae la red de 60 Hz
    // y la deriva de la línea base, que tapan el ECG. Al volver a la simulación se restaura lo que había.
    let filtrosSimulacion = null;
    function filtrosParaFuente(conArduino) {
        if (conArduino) {
            if (!filtrosSimulacion) filtrosSimulacion = FILTROS.map(([, key]) => processor[key]);
            for (const [btn, key] of FILTROS) fijarFiltro(btn, key, true);
        } else if (filtrosSimulacion) {
            FILTROS.forEach(([btn, key], i) => fijarFiltro(btn, key, filtrosSimulacion[i]));
            filtrosSimulacion = null;
        }
        updateFilterLabel();
    }
    btnHP.addEventListener('click', () => toggleFilter(btnHP, 'hpEnabled'));
    btnLP.addEventListener('click', () => toggleFilter(btnLP, 'lpEnabled'));
    btnNotch.addEventListener('click', () => toggleFilter(btnNotch, 'notchEnabled'));

    btnPlay.addEventListener('click', () => {
        isRunning = !isRunning;
        btnPlay.setAttribute('aria-label', isRunning ? 'Pausar' : 'Reanudar');
        btnPlay.classList.toggle('paused', !isRunning);
        btnPlay.querySelector('use').setAttribute('href', isRunning ? '#i-pause' : '#i-play');
    });

    function updateFilterLabel() {
        const active = [];
        if (processor.hpEnabled) active.push('HP');
        if (processor.notchEnabled) active.push('NOTCH');
        if (processor.lpEnabled) active.push('LP');
        filterStatus.textContent = active.length > 0 ? active.join(' + ') : 'INACTIVOS';
    }

    // ¿La señal viene de un Arduino (USB directo o servidor) o del generador simulado?
    // UsbSerial y ArduinoLink son "const" de otros scripts: no cuelgan de window, por eso se usa typeof
    function fuenteActiva() {
        if (typeof UsbSerial !== 'undefined' && UsbSerial.active) return UsbSerial;
        if (typeof ArduinoLink !== 'undefined' && ArduinoLink.active) return ArduinoLink;
        return null;
    }

    function pintarEstado(fuente) {
        const { texto, clase } = fuente ? fuente.estadoSenal() : { texto: isRunning ? 'SIMULACIÓN' : 'EN PAUSA', clase: 'live' };
        statusText.textContent = !isRunning && fuente ? 'EN PAUSA' : texto;
        statusPill.dataset.estado = !isRunning ? 'pausa' : clase;
    }

    /** Texto bajo el monitor cuando la señal viene del Arduino: explica por qué hay (o no) un BPM. */
    function avisoCalidad(calidad) {
        const textos = {
            calibrando: 'Midiendo… quédate quieto: la frecuencia cardíaca aparece en unos 5 segundos.',
            buena: 'Señal real del Arduino: frecuencia cardíaca confiable (mediana de los últimos 8 latidos). Filtros activos: pasa-altas 0.5 Hz, notch 60 Hz y pasa-bajas 40 Hz.',
            'sin-contacto': 'El AD8232 no está recibiendo tu ECG: casi toda la señal es la interferencia de la red eléctrica (60 Hz). Revisa: 1) que el cable de los electrodos esté bien metido en el conector del AD8232; 2) que las 3 almohadillas (RA, LA y RL) estén pegadas a la piel limpia y seca; 3) desconecta el cargador del computador. Cuando haya contacto, aparecerán los latidos.',
            ruido: 'Señal con ruido o interferencia: no se muestra una frecuencia cardíaca para no dar un valor falso. Quédate quieto, no hables, aleja el cable del cargador y revisa que los 3 electrodos estén bien pegados.',
            antiguo: 'Tu Arduino tiene un sketch antiguo (formato del Serial Plotter, pocos puntos por segundo): no alcanza para medir la frecuencia cardíaca. Carga arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino (versión 3) desde el Arduino IDE.',
            irregular: 'Latidos irregulares o artefactos de movimiento: quédate quieto unos segundos.',
            'sin-senal': 'No se detectan latidos: revisa que los 3 electrodos (RA, LA, RL) estén pegados a la piel y conectados al AD8232.',
        };
        return textos[calidad] || textos.calibrando;
    }

    // Muestra un valor numérico o "--" mientras todavía no hay medición
    const mostrar = (valor, decimales = 0) => (valor === null || !Number.isFinite(valor) ? '--' : valor.toFixed(decimales));

    function ciclo(ahora) {
        requestAnimationFrame(ciclo);

        // El reloj avanza siempre, incluso en pausa, para no generar una ráfaga de muestras al reanudar
        const dt = lastFrame === null ? 0 : Math.min((ahora - lastFrame) / 1000, MAX_CATCHUP_S);
        lastFrame = ahora;

        const fuente = fuenteActiva();
        if (fuente !== lastSource) {
            lastSource = fuente;
            signalHeading.textContent = fuente ? fuente.etiqueta : 'ECG simulado · fs = 250 Hz';
            signalNotice.textContent = fuente ? avisoCalidad('calibrando') : AVISO_SIMULACION;
            filtrosParaFuente(!!fuente);
            simControls.classList.toggle('dim', !!fuente);
            processor.resetDetector();     // otra señal → el detector debe recalibrarse
            renderer.clear();
            sampleDebt = 0;
        }

        if (!isRunning) {
            if (fuente) fuente.drain();    // en pausa se descartan las muestras que siguen llegando
            if (ahora - lastMetricsUpdate >= 250) { lastMetricsUpdate = ahora; pintarEstado(fuente); }
            return;
        }

        let hasNewSamples = false;
        if (fuente) {
            // El ritmo lo marca el Arduino: se procesan todas las muestras recibidas
            processor.fs = fuente.fs || fs;
            renderer.setSampleRate(processor.fs);
            for (const rawSample of fuente.drain()) {
                currentTime += 1 / processor.fs;
                renderer.addSample(processor.processSample(rawSample, currentTime));
                hasNewSamples = true;
            }
        } else {
            processor.fs = fs;
            renderer.setSampleRate(fs);
            sampleDebt += dt * fs;
            while (sampleDebt >= 1) {
                sampleDebt -= 1;
                currentTime += 1 / fs;
                renderer.addSample(processor.processSample(generator.nextSample(), currentTime));
                hasNewSamples = true;
            }
        }
        if (hasNewSamples) renderer.render();

        // ¿Qué frecuencia cardíaca se muestra? La del detector de la página: ve las mismas muestras que
        // se dibujan y solo da un valor si la señal es confiable (si no, "--").
        // Con el formato del Serial Plotter (25–40 puntos/s, sketch antiguo) no hay señal suficiente para
        // medirla y la FC de ese sketch no es confiable (contaba la onda T o el ruido): se muestra "--".
        const senalIncompleta = fuente && processor.fs < 100;
        const currentBPM = senalIncompleta ? null : processor.detectedBPM;
        lastBpm = currentBPM;
        lastSourceName = fuente ? 'arduino' : 'simulado';

        if (ahora - lastMetricsUpdate >= 250) {
            lastMetricsUpdate = ahora;
            bpmDisplay.textContent = mostrar(currentBPM);
            freqDisplay.textContent = currentBPM ? mostrar(currentBPM / 60, 2) : '--';
            rrDisplay.textContent = currentBPM ? mostrar(60 / currentBPM, 2) : '--';
            pintarEstado(fuente);
            if (fuente) signalNotice.textContent = avisoCalidad(senalIncompleta ? 'antiguo' : processor.diagnosticoSenal);
            if (fuente && fuente.mostrarDiagnostico) fuente.mostrarDiagnostico(senalIncompleta ? null : processor.diagnosticoSenal);
        }
    }

    renderer.render();               // dibuja la cuadrícula desde el primer instante
    requestAnimationFrame(ciclo);
});
