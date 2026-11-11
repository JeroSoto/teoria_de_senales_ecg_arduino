// ============================================================
// Enlace en tiempo real con el Arduino a través del servidor (npm start):
//  - EventSource (SSE) recibe muestras, BPM y estado
//  - POST /api/arduino/comando envía comandos
//  - POST /api/arduino/puerto libera el USB (para subir un sketch) o reconecta
// Todo el estado queda sincronizado entre pestañas/usuarios
// porque el servidor transmite los mismos eventos a todos.
// ============================================================
const ArduinoLink = {
    nombre: 'servidor',
    etiqueta: 'ECG real · Arduino (servidor)',
    active: false,      // true = el monitor dibuja la señal del Arduino
    fs: 250,
    bpm: null,
    queue: [],
    stream: null,
    estado: null,
    ultimaMuestra: 0,
    estabaConectado: false,
    servidorCaido: false,

    // app.js llama a drain() en cada ciclo para recoger las muestras pendientes
    drain() {
        const out = this.queue;
        this.queue = [];
        return out;
    },

    init() {
        const $ = (id) => document.getElementById(id);
        this.el = {
            lock: $('arduinoLock'), panel: $('arduinoPanel'), status: $('arduinoStatus'),
            device: $('adDevice'), port: $('adPort'), fs: $('adFs'), bpm: $('adBpm'), leads: $('adLeads'),
            use: $('btnArduinoUse'), ping: $('btnArduinoPing'), puerto: $('btnArduinoPort'),
            led: $('chkArduinoLed'), streamChk: $('chkArduinoStream'), selFs: $('selArduinoFs'),
            der: $('adDer'), ritmo: $('adRitmo'), selDer: $('selArduinoDer'),
            log: $('arduinoLog'),
        };

        this.el.use.addEventListener('click', () => this.fijarActivo(!this.active));
        this.el.ping.addEventListener('click', () => this.comando('PING'));
        this.el.puerto.addEventListener('click', () => this.alternarPuerto());
        this.el.led.addEventListener('change', () => this.comando('LED', this.el.led.checked ? 1 : 0));
        this.el.streamChk.addEventListener('change', () => this.comando(this.el.streamChk.checked ? 'START' : 'STOP'));
        this.el.selFs.addEventListener('change', () => this.comando('FS', this.el.selFs.value));
        this.el.selDer.addEventListener('change', () => this.comando('DER', this.el.selDer.value));

        document.addEventListener('auth:change', (e) => (e.detail ? this.conectar() : this.desconectar()));
        document.addEventListener('fuente:activa', (e) => {
            if (e.detail !== this.nombre && this.active) this.fijarActivo(false, false);
        });
    },

    fijarActivo(activo, avisar = true) {
        this.active = activo;
        this.queue = [];
        this.el.use.textContent = activo ? 'Volver a la simulación' : 'Usar señal del Arduino';
        this.el.use.classList.toggle('btn-disconnect', activo);
        this.el.use.classList.toggle('btn-connect', !activo);
        if (activo && avisar) document.dispatchEvent(new CustomEvent('fuente:activa', { detail: this.nombre }));
    },

    conectar() {
        // En la página publicada (Vercel) no hay Arduino por el servidor: se usa «Arduino por USB»
        if (window.ECGModo && window.ECGModo.arduino === 'ninguno') return;
        this.el.lock.hidden = true;
        this.el.panel.hidden = false;
        if (this.stream) return;

        this.stream = new EventSource('/api/arduino/stream');
        this.stream.addEventListener('samples', (e) => {
            const d = JSON.parse(e.data);
            this.fs = d.fs || this.fs;
            this.ultimaMuestra = Date.now();
            if (this.active) {
                this.queue.push(...d.samples);
                if (this.queue.length > 5000) this.queue.splice(0, this.queue.length - 5000);
            }
        });
        this.stream.addEventListener('bpm', (e) => {
            this.bpm = JSON.parse(e.data).bpm;
            this.el.bpm.textContent = `${this.bpm} lpm`;
        });
        this.stream.addEventListener('status', (e) => {
            this.servidorCaido = false;
            this.mostrarEstado(JSON.parse(e.data));
        });
        this.stream.onerror = () => {
            // EventSource reintenta solo; si la sesión expiró el servidor responde 401
            this.servidorCaido = true;
            this.fijarEstadoTexto('Sin conexión con el servidor. ¿Sigue abierta la terminal con npm start? Reintentando…', 'error');
            this.habilitar(false);
        };
    },

    desconectar() {
        if (this.stream) this.stream.close();
        this.stream = null;
        if (this.active) this.fijarActivo(false);
        this.bpm = null;
        this.estabaConectado = false;
        this.el.lock.hidden = false;
        this.el.panel.hidden = true;
        this.el.log.replaceChildren();
    },

    fijarEstadoTexto(texto, clase = '') {
        this.el.status.textContent = texto;
        this.el.status.classList.toggle('connected', clase === 'connected');
        this.el.status.classList.toggle('error', clase === 'error');
        this.el.status.classList.toggle('warn', clase === 'warn');
    },

    habilitar(conectado) {
        for (const c of [this.el.use, this.el.ping, this.el.led, this.el.streamChk, this.el.selFs, this.el.selDer]) c.disabled = !conectado;
    },

    mostrarEstado(e) {
        this.estado = e;
        this.fs = e.fs || this.fs;
        this.habilitar(e.conectado);
        this.el.puerto.disabled = false;
        this.el.puerto.textContent = e.liberado ? 'Reconectar' : 'Liberar puerto';
        this.el.puerto.classList.toggle('btn-connect', e.liberado);

        const real = e.modo === 'serial';
        if (e.liberado) {
            this.fijarEstadoTexto('Puerto liberado: ya puedes subir el sketch desde el Arduino IDE. Luego pulsa «Reconectar».', 'warn');
        } else if (!e.conectado) {
            this.fijarEstadoTexto(`Arduino desconectado${e.error ? `: ${e.error}` : ''}. Reintentando cada 3 s…`, 'error');
        } else if (e.sinDatos) {
            this.fijarEstadoTexto('El puerto está abierto pero no llegan datos. Revisa que el sketch sea ecg_plotter_teoria.ino y que ARDUINO_BAUD=115200.', 'warn');
        } else if (e.derivacionesSueltas) {
            this.fijarEstadoTexto('Arduino conectado, pero hay electrodos sueltos (RA, LA, RL).', 'warn');
        } else if (e.sketchAntiguo) {
            this.fijarEstadoTexto('Tu Arduino tiene un sketch antiguo: su frecuencia cardíaca no es confiable y no se muestra. Carga arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino (versión 3) desde el Arduino IDE.', 'warn');
        } else if (e.formato === 'numeros') {
            this.fijarEstadoTexto('Recibiendo datos de un sketch genérico (sin comandos). Para todas las funciones sube ecg_plotter_teoria.ino.', 'connected');
        } else {
            this.fijarEstadoTexto(real ? 'Arduino conectado: recibiendo el ECG en tiempo real.' : 'Conectado a un Arduino simulado (ARDUINO_MODE=simulate).', 'connected');
        }

        // Al conectarse un Arduino real, el monitor cambia solo a su señal (se puede volver a la simulación)
        if (real && e.conectado && !this.estabaConectado && !this.active) this.fijarActivo(true);
        this.estabaConectado = e.conectado;

        this.el.device.textContent = e.dispositivo || '—';
        this.el.port.textContent = real ? `${e.puerto}${e.baudios ? ` · ${e.baudios} baud` : ''}` : 'Simulado';
        this.el.der.textContent = e.derivacion || '—';
        this.el.ritmo.textContent = e.rr
            ? `${e.ritmoRegular ? 'Regular' : 'Irregular'} · ${e.qrsMv !== null ? `${e.qrsMv.toFixed(2)} mV` : '—'}`
            : '—';
        if (e.derivacion) this.el.selDer.value = e.derivacion;
        this.el.fs.textContent = `${e.fs} Hz`;
        if (!e.bpm) this.bpm = null;   // el Arduino ya no tiene una medición confiable (H,0)
        this.el.bpm.textContent = e.bpm ? `${e.bpm} lpm` : e.sketchAntiguo ? '— (sketch antiguo)' : '—';
        const sinContacto = this.diagnostico === 'sin-contacto';
        this.el.leads.textContent = !e.conectado ? '—'
            : e.derivacionesSueltas ? '⚠ Sueltos'
            : sinContacto ? '⚠ Sin contacto (solo 60 Hz)'
            : this.diagnostico === 'saturado' ? '⚠ AD8232 saturado (revisa RL)'
            : this.diagnostico === 'buena' ? 'Con contacto' : 'Sin verificar';
        this.el.leads.classList.toggle('warn', e.derivacionesSueltas || sinContacto);
        // Sincroniza los controles con lo que realmente confirmó el Arduino
        this.el.led.checked = e.led === 1;
        this.el.streamChk.checked = e.transmitiendo;
        this.el.selFs.value = String(e.fs);
    },

    /** El servidor avisa si el ADC tocó 0 o 1023 en los últimos 5 s (AD8232 saturado). */
    get saturada() {
        return !!(this.estado && this.estado.saturado);
    },

    get saturadaReciente() {
        return !!(this.estado && this.estado.saturadoReciente);
    },

    estadoSenal() {
        const e = this.estado;
        if (this.servidorCaido || !e) return { texto: 'SIN SERVIDOR', clase: 'error' };
        if (e.liberado) return { texto: 'PUERTO LIBRE', clase: 'warn' };
        if (!e.conectado) return { texto: 'DESCONECTADO', clase: 'error' };
        if (e.derivacionesSueltas) return { texto: 'ELECTRODOS', clase: 'warn' };
        if (Date.now() - this.ultimaMuestra > 2500) return { texto: 'SIN DATOS', clase: 'warn' };
        if (this.diagnostico === 'sin-contacto') return { texto: 'SIN CONTACTO', clase: 'warn' };
        if (this.diagnostico === 'saturado') return { texto: 'SATURADO', clase: 'warn' };
        return { texto: 'EN VIVO', clase: 'live' };
    },

    /** app.js informa el diagnóstico de la señal (p. ej. 'sin-contacto') para la tarjeta de electrodos. */
    mostrarDiagnostico(diagnostico) {
        if (diagnostico === this.diagnostico) return;
        this.diagnostico = diagnostico;
        if (this.estado) this.mostrarEstado(this.estado);
    },

    async alternarPuerto() {
        const accion = this.estado && this.estado.liberado ? 'conectar' : 'liberar';
        this.el.puerto.disabled = true;
        let resultado;
        try {
            const r = await API.post('/api/arduino/puerto', { accion });
            resultado = { ok: true, info: r.info };
            this.mostrarEstado(r.estado);
        } catch (err) {
            resultado = { ok: false, info: err.data && err.data.info ? err.data.info : err.message };
            this.el.puerto.disabled = false;
        }
        this.registrar('PUERTO', accion, resultado);
    },

    async comando(comando, valor) {
        let resultado;
        try {
            const r = await API.post('/api/arduino/comando', valor === undefined ? { comando } : { comando, valor });
            resultado = { ok: true, info: r.info };
        } catch (err) {
            resultado = { ok: false, info: err.data && err.data.info ? err.data.info : err.message };
            if (this.estado) this.mostrarEstado(this.estado); // revierte controles al último estado real
        }
        this.registrar(comando, valor, resultado);
    },

    registrar(comando, valor, { ok, info }) {
        const li = document.createElement('li');
        li.className = ok ? 'ok' : 'err';
        li.textContent = `${new Date().toLocaleTimeString()} · ${comando}${valor === undefined ? '' : ',' + valor} → ${ok ? 'OK' : 'ERROR'} (${info})`;
        this.el.log.prepend(li);
        while (this.el.log.children.length > 8) this.el.log.lastChild.remove();
    },
};

document.addEventListener('DOMContentLoaded', () => ArduinoLink.init());
