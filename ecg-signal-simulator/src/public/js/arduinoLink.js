// ============================================================
// Enlace en tiempo real con el Arduino a través del servidor:
//  - EventSource (SSE) recibe muestras, BPM y estado
//  - POST /api/arduino/comando envía comandos
// Todo el estado queda sincronizado entre pestañas/usuarios
// porque el servidor transmite los mismos eventos a todos.
// ============================================================
const ArduinoLink = {
    active: false,      // true = el monitor dibuja la señal del Arduino
    fs: 250,
    bpm: null,
    queue: [],
    stream: null,
    estado: null,

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
            use: $('btnArduinoUse'), ping: $('btnArduinoPing'),
            led: $('chkArduinoLed'), streamChk: $('chkArduinoStream'), selFs: $('selArduinoFs'),
            log: $('arduinoLog'),
        };

        this.el.use.addEventListener('click', () => this.alternarUso());
        this.el.ping.addEventListener('click', () => this.comando('PING'));
        this.el.led.addEventListener('change', () => this.comando('LED', this.el.led.checked ? 1 : 0));
        this.el.streamChk.addEventListener('change', () => this.comando(this.el.streamChk.checked ? 'START' : 'STOP'));
        this.el.selFs.addEventListener('change', () => this.comando('FS', this.el.selFs.value));

        document.addEventListener('auth:change', (e) => (e.detail ? this.conectar() : this.desconectar()));
    },

    alternarUso() {
        this.active = !this.active;
        this.queue = [];
        this.el.use.textContent = this.active ? 'Volver a la simulación' : 'Usar señal del Arduino';
        this.el.use.classList.toggle('btn-disconnect', this.active);
        this.el.use.classList.toggle('btn-connect', !this.active);
    },

    conectar() {
        this.el.lock.hidden = true;
        this.el.panel.hidden = false;
        if (this.stream) return;

        this.stream = new EventSource('/api/arduino/stream');
        this.stream.addEventListener('samples', (e) => {
            const d = JSON.parse(e.data);
            this.fs = d.fs || this.fs;
            if (this.active) {
                this.queue.push(...d.samples);
                if (this.queue.length > 5000) this.queue.splice(0, this.queue.length - 5000);
            }
        });
        this.stream.addEventListener('bpm', (e) => {
            this.bpm = JSON.parse(e.data).bpm;
            this.el.bpm.textContent = `${this.bpm} lpm`;
        });
        this.stream.addEventListener('status', (e) => this.mostrarEstado(JSON.parse(e.data)));
        this.stream.onerror = () => {
            // EventSource reintenta solo; si la sesión expiró el servidor responde 401
            this.fijarEstadoTexto('Sin conexión con el servidor. Reintentando…', 'error');
            this.habilitar(false);
        };
    },

    desconectar() {
        if (this.stream) this.stream.close();
        this.stream = null;
        if (this.active) this.alternarUso();
        this.bpm = null;
        this.el.lock.hidden = false;
        this.el.panel.hidden = true;
        this.el.log.replaceChildren();
    },

    fijarEstadoTexto(texto, clase = '') {
        this.el.status.textContent = texto;
        this.el.status.classList.toggle('connected', clase === 'connected');
        this.el.status.classList.toggle('error', clase === 'error');
    },

    habilitar(conectado) {
        for (const c of [this.el.use, this.el.ping, this.el.led, this.el.streamChk, this.el.selFs]) c.disabled = !conectado;
    },

    mostrarEstado(e) {
        this.estado = e;
        this.fs = e.fs || this.fs;
        this.habilitar(e.conectado);
        if (e.conectado) {
            this.fijarEstadoTexto(
                e.modo === 'simulate' ? 'Conectado a un Arduino simulado (modo de pruebas).' : 'Arduino conectado.',
                'connected'
            );
        } else {
            this.fijarEstadoTexto(`Arduino desconectado${e.error ? `: ${e.error}` : ''}. Reintentando…`, 'error');
        }
        this.el.device.textContent = e.dispositivo || '—';
        this.el.port.textContent = e.modo === 'simulate' ? 'Simulado' : e.puerto;
        this.el.fs.textContent = `${e.fs} Hz`;
        this.el.bpm.textContent = e.bpm ? `${e.bpm} lpm` : '—';
        this.el.leads.textContent = e.derivacionesSueltas ? '⚠ Sueltos' : 'OK';
        this.el.leads.classList.toggle('warn', e.derivacionesSueltas);
        // Sincroniza los controles con lo que realmente confirmó el Arduino
        this.el.led.checked = e.led === 1;
        this.el.streamChk.checked = e.transmitiendo;
        this.el.selFs.value = String(e.fs);
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
