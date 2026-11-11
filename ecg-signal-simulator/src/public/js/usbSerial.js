// ============================================================
// Arduino por USB directamente desde el navegador (Web Serial API).
//  - No necesita servidor: funciona en la página publicada (Vercel) y en npm start.
//  - Chrome o Edge de computador. Safari y Firefox no tienen Web Serial.
//  - Sketch del proyecto: arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino. Arranca en modo
//    «gráfica» (II:123,FC:72,Cero:0, para el Serial Plotter); al verlo se le envía "WEB" y pasa a:
//      S,<adc>  H,<bpm>  R,<rr>,<qrs>,<regular>  D,<derivación>  L,<0|1>  I,…,fs=<Hz>  A,<CMD>,<OK|ERR>,<info>
//  - También entiende el formato del Plotter tal cual y sketches que solo imprimen analogRead(A0).
//  - Si no llega nada legible, prueba 115200 y luego 9600 baudios.
// ============================================================
const UsbSerial = {
    nombre: 'usb',
    etiqueta: 'ECG real · Arduino por USB',
    soportado: typeof navigator !== 'undefined' && 'serial' in navigator,
    active: false,          // true = el monitor dibuja esta señal
    conectado: false,
    fs: 250,
    bpm: null,
    queue: [],
    port: null,
    reader: null,
    lectura: null,
    cerrando: false,
    recordar: false,        // reconecta solo si se vuelve a enchufar la placa
    dc: null,
    countsPerMv: 225,       // AD8232 (ganancia 1100) con ADC de 10 bits y referencia de 5 V
    formato: null,          // 'protocolo' | 'numeros'
    ultimaLectura: 0,
    abiertoEn: 0,
    sueltos: false,
    transmitiendo: true,
    led: 0,
    pendientes: new Map(),
    conteo: { n: 0, desde: 0 },
    validas: 0,
    derivacion: null,
    ritmo: null,
    pedidosWeb: 0,
    ultimoPedidoWeb: 0,
    cambiandoBaudios: false,

    BAUDIOS: [115200, 9600],
    iBaudios: 0,
    DERIVACIONES: ['I', 'II', 'III', 'AVR', 'AVL', 'AVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'],
    // Chips USB-serie de Arduino y clones (la lista filtra los puertos Bluetooth del selector)
    FILTROS: [0x2341, 0x2a03, 0x1a86, 0x0403, 0x10c4, 0x239a, 0x1b4f, 0x03eb, 0x2e8a].map((usbVendorId) => ({ usbVendorId })),
    VENDORS: { 0x2341: 'Arduino', 0x2a03: 'Arduino', 0x1a86: 'CH340 (clon)', 0x0403: 'FTDI', 0x10c4: 'CP210x', 0x239a: 'Adafruit', 0x1b4f: 'SparkFun', 0x03eb: 'Atmel', 0x2e8a: 'Raspberry Pi Pico' },

    drain() {
        const out = this.queue;
        this.queue = [];
        return out;
    },

    init() {
        const $ = (id) => document.getElementById(id);
        this.el = {
            card: $('usbCard'), panel: $('usbPanel'), status: $('usbStatus'),
            device: $('usbDevice'), fsTxt: $('usbFs'), bpm: $('usbBpm'), leads: $('usbLeads'),
            connect: $('btnUsbConnect'), use: $('btnUsbUse'), all: $('btnUsbAll'), ping: $('btnUsbPing'),
            led: $('chkUsbLed'), streamChk: $('chkUsbStream'), selFs: $('selUsbFs'), log: $('usbLog'),
            der: $('usbDer'), ritmo: $('usbRitmo'), selDer: $('selUsbDer'),
        };

        document.addEventListener('modo:listo', (e) => this.alModo(e.detail));
        document.addEventListener('fuente:activa', (e) => {
            if (e.detail !== this.nombre && this.active) this.fijarActivo(false, false);
        });

        if (!this.soportado) return;

        this.el.connect.addEventListener('click', () => (this.port ? this.desconectar() : this.conectar(false)));
        this.el.all.addEventListener('click', () => this.conectar(true));
        this.el.use.addEventListener('click', () => this.fijarActivo(!this.active));
        this.el.ping.addEventListener('click', () => this.comando('PING'));
        this.el.led.addEventListener('change', () => this.comando('LED', this.el.led.checked ? 1 : 0));
        this.el.streamChk.addEventListener('change', () => this.comando(this.el.streamChk.checked ? 'START' : 'STOP'));
        this.el.selFs.addEventListener('change', () => this.comando('FS', this.el.selFs.value));
        this.el.selDer.addEventListener('change', () => this.comando('DER', this.el.selDer.value));

        navigator.serial.addEventListener('disconnect', (e) => {
            if (e.target !== this.port) return;
            this.alPerderConexion('Se desconectó el cable USB. Vuelve a conectarlo y se reconectará solo.');
            try { if (this.reader) this.reader.cancel(); } catch { /* sin lector */ }
        });
        navigator.serial.addEventListener('connect', (e) => {
            if (this.recordar && !this.port) this.abrir(e.target).catch((err) => this.estado(this.explicar(err), 'error'));
        });

        setInterval(() => this.vigilar(), 1000);
    },

    /** Decide si esta tarjeta se muestra: no, si el servidor (npm start) ya tiene el puerto abierto. */
    alModo({ modo, arduino }) {
        const servidorUsaPuerto = modo === 'servidor' && arduino === 'serial';
        this.el.card.hidden = servidorUsaPuerto;
        if (servidorUsaPuerto) return;
        if (!this.soportado) {
            this.el.panel.hidden = true;
            this.estado('Para ver tu Arduino en vivo, abre esta página en Chrome o Edge en el computador donde está conectado por USB. En este navegador funciona la simulación.');
        }
    },

    async conectar(todos) {
        try {
            const port = await navigator.serial.requestPort(todos ? {} : { filters: this.FILTROS });
            this.iBaudios = 0;
            await this.abrir(port);
        } catch (err) {
            if (err && err.name === 'NotFoundError') {
                this.estado('No elegiste ningún puerto. Si tu placa no aparece en la lista, pulsa «Ver todos los puertos».');
            } else {
                this.estado(this.explicar(err), 'error');
            }
        }
    },

    async abrir(port) {
        this.estado('Abriendo el puerto…');
        await port.open({ baudRate: this.BAUDIOS[this.iBaudios] });
        this.port = port;
        this.conectado = true;
        this.recordar = true;
        this.cerrando = false;
        this.dc = null;
        this.formato = null;
        this.sueltos = false;
        this.transmitiendo = true;
        this.bpm = null;
        this.conteo = { n: 0, desde: 0 };
        this.abiertoEn = Date.now();
        this.ultimaLectura = 0;
        this.validas = 0;
        this.derivacion = null;
        this.ritmo = null;
        this.version = null;
        this.leadsMedido = false;     // true cuando el sketch informa los electrodos (líneas L, USAR_LEADS_OFF)
        this.diagnostico = null;
        this.pedidosWeb = 0;
        this.ultimoPedidoWeb = 0;

        const info = port.getInfo ? port.getInfo() : {};
        this.el.device.textContent = this.VENDORS[info.usbVendorId] || (info.usbVendorId ? `USB ${info.usbVendorId.toString(16)}` : 'Puerto serie');
        this.el.connect.textContent = 'Desconectar';
        this.el.connect.classList.replace('btn-connect', 'btn-disconnect');
        this.habilitar(true);
        this.pintar();
        // El Uno se reinicia al abrir el puerto: los datos llegan ~2 s después
        this.estado('Conectado. Esperando datos (el Arduino se reinicia al conectar)…', 'connected');
        if (!this.active) this.fijarActivo(true);
        this.lectura = this.leer();
    },

    async leer() {
        const port = this.port;
        const decoder = new TextDecoder();
        let resto = '';
        while (this.port === port && port.readable && !this.cerrando) {
            this.reader = port.readable.getReader();
            try {
                for (;;) {
                    const { value, done } = await this.reader.read();
                    if (done) break;
                    resto += decoder.decode(value, { stream: true });
                    const lineas = resto.split('\n');
                    resto = lineas.pop();
                    if (resto.length > 200) resto = ''; // basura sin saltos de línea (baudios incorrectos)
                    for (const l of lineas) this.procesarLinea(l.trim());
                }
            } catch (err) {
                // Errores de trama o de búfer son recuperables: el bucle vuelve a leer.
                if (err && err.name === 'NetworkError') break;
            } finally {
                try { this.reader.releaseLock(); } catch { /* ya liberado */ }
                this.reader = null;
            }
        }
        if (!this.cerrando) {
            this.alPerderConexion('Se perdió la conexión con el Arduino. Vuelve a conectarlo.');
            try { await port.close(); } catch { /* ya cerrado */ } // permite reabrirlo al reconectar
        }
    },

    async desconectar() {
        this.recordar = false;
        this.cerrando = true;
        try { if (this.reader) await this.reader.cancel(); } catch { /* sin lector activo */ }
        try { await this.lectura; } catch { /* la lectura ya terminó */ }
        try { if (this.port) await this.port.close(); } catch { /* ya cerrado */ }
        this.port = null;
        this.alPerderConexion('Desconectado. La señal vuelve a la simulación.', false);
        if (this.active) this.fijarActivo(false);
    },

    alPerderConexion(mensaje, error = true) {
        if (!this.conectado || this.cambiandoBaudios) return;
        this.conectado = false;
        this.port = null;
        for (const p of this.pendientes.values()) { clearTimeout(p.timer); p.resolve({ ok: false, info: 'Arduino desconectado.' }); }
        this.pendientes.clear();
        this.el.connect.textContent = 'Conectar Arduino';
        this.el.connect.classList.replace('btn-disconnect', 'btn-connect');
        this.habilitar(false);
        this.estado(mensaje, error ? 'error' : '');
    },

    /** app.js informa el diagnóstico de la señal (p. ej. 'sin-contacto') para la tarjeta de electrodos. */
    mostrarDiagnostico(diagnostico) {
        if (diagnostico === this.diagnostico) return;
        this.diagnostico = diagnostico;
        this.pintar();
    },

    /** Sketch anterior a la versión 3: cuenta la onda T o el ruido como latidos, su BPM no se usa. */
    sketchAntiguo() {
        return this.formato === 'plotter' || this.formato === 'numeros' || (this.version !== null && this.version < 3);
    },

    // ---------- Recepción ----------
    procesarLinea(linea) {
        if (!linea || !this.interpretar(linea)) return; // basura (baudios incorrectos): no cuenta
        this.validas++;
        this.ultimaLectura = Date.now();
    },

    /** @returns {boolean} true si la línea tenía un formato conocido */
    interpretar(linea) {
        if (/^-?\d+(\.\d+)?$/.test(linea)) { this.muestraGenerica(Number(linea)); return true; }
        if (linea === '!') { this.sueltos = true; return true; }
        if (/^[A-Za-z][A-Za-z0-9_]*:-?\d/.test(linea)) { this.lineaPlotter(linea); return true; }

        const [tipo, ...resto] = linea.split(',');
        switch (tipo) {
            case 'S': {
                const adc = Number(resto[0]);
                if (!Number.isFinite(adc)) return false;
                this.formato = 'protocolo';
                this.agregar(adc);
                return true;
            }
            case 'H': {
                const bpm = Number(resto[0]);
                if (!Number.isFinite(bpm)) return false;
                if (this.sketchAntiguo()) { this.bpm = null; this.el.bpm.textContent = '— (sketch antiguo)'; return true; }
                if (bpm >= 30 && bpm <= 220) { this.bpm = bpm; this.el.bpm.textContent = `${bpm} lpm`; }
                else if (bpm === 0) { this.bpm = null; this.el.bpm.textContent = '—'; }   // H,0: sin medición confiable
                return true;
            }
            case 'R': {
                const [rr, qrs, regular] = resto.map(Number);
                if (!Number.isFinite(rr)) return false;
                this.ritmo = { rr, qrsMv: Number.isFinite(qrs) ? qrs / 100 : null, regular: regular === 1 };
                this.pintar();
                return true;
            }
            case 'D':
                if (!this.DERIVACIONES.includes(resto[0])) return false;
                this.derivacion = resto[0];
                this.pintar();
                return true;
            case 'L':
                if (resto[0] !== '0' && resto[0] !== '1') return false;
                this.sueltos = resto[0] === '1';
                this.leadsMedido = true;
                this.pintar();
                return true;
            case 'I': {
                if (!resto.length) return false;
                const fs = /fs=(\d+)/.exec(linea);
                this.formato = 'protocolo';
                if (fs) this.fs = Number(fs[1]);
                this.dc = null;
                this.version = parseFloat(resto[1]) || null;
                this.el.device.textContent = `${resto[0]} v${resto[1] || '?'}`;
                // el sketch v3 arranca en modo gráfica: quita el aviso de "sketch antiguo" de ese primer segundo
                if (!this.sketchAntiguo() && !this.bpm) this.el.bpm.textContent = '—';
                this.pintar();
                return true;
            }
            case 'A':
                if (resto.length < 2) return false;
                this.ack(resto);
                return true;
            default:
                return false;
        }
    },

    /** Modo gráfica de ecg_plotter_teoria.ino (II:123,FC:72,Cero:0): muestra filtrada y centrada en 0. */
    lineaPlotter(linea) {
        let muestra = null;
        let etiqueta = null;
        let fc = null;
        for (const campo of linea.split(/[,\s]+/)) {
            const [clave, valor] = campo.split(':');
            const n = Number(valor);
            if (!clave || valor === undefined || !Number.isFinite(n)) continue;
            const k = clave.toUpperCase();
            if (k === 'FC') fc = n;
            else if (k !== 'CERO' && muestra === null) { muestra = n; etiqueta = k; }
        }
        if (muestra === null) return;
        if (this.formato !== 'plotter') {
            this.formato = 'plotter';
            this.el.device.textContent = 'ecg_plotter_teoria (gráfica)';
        }
        this.sueltos = etiqueta === 'SUELTO';
        if (!this.sueltos && this.DERIVACIONES.includes(etiqueta) && etiqueta !== this.derivacion) {
            this.derivacion = etiqueta;
            this.pintar();
        }
        // La FC de un sketch en formato del Plotter (versiones anteriores) no es confiable: no se usa
        if (fc !== null) { this.bpm = null; this.el.bpm.textContent = '— (sketch antiguo)'; }
        // Pide el protocolo completo (250 Hz); si el sketch no lo entiende, se sigue con este formato
        const ahora = Date.now();
        if (this.pedidosWeb < 4 && ahora - this.ultimoPedidoWeb > 2500) {
            this.pedidosWeb++;
            this.ultimoPedidoWeb = ahora;
            this.escribir('WEB').catch(() => { /* puerto cerrándose */ });
        }
        this.muestraGenerica(muestra, true);
    },

    async escribir(texto) {
        if (!this.port || !this.port.writable) throw new Error('Puerto cerrado.');
        const writer = this.port.writable.getWriter();
        try {
            await writer.write(new TextEncoder().encode(`${texto}\n`));
        } finally {
            writer.releaseLock();
        }
    },

    agregar(adc) {
        // Quita la componente continua con un promedio móvil exponencial (τ ≈ 1.5 s) y pasa a mV
        this.dc = this.dc === null ? adc : this.dc + (adc - this.dc) / (this.fs * 1.5);
        if (this.active) {
            this.queue.push((adc - this.dc) / this.countsPerMv);
            if (this.queue.length > 5000) this.queue.splice(0, this.queue.length - 5000);
        }
    },

    muestraGenerica(adc, yaClasificada = false) {
        if (!yaClasificada) {
            if (this.formato !== 'numeros') {
                this.formato = 'numeros';
                this.el.device.textContent = 'Sketch genérico';
            }
            this.sueltos = false;
        }
        // Sin línea "I" no se conoce fs: se estima contando muestras en ventanas de 2 s
        const ahora = Date.now();
        const c = this.conteo;
        if (!c.desde) c.desde = ahora;
        c.n++;
        if (ahora - c.desde >= 2000) {
            const medida = Math.round((c.n * 1000) / (ahora - c.desde) / 5) * 5;
            if (medida >= 1 && Math.abs(medida - this.fs) / this.fs > 0.1) { this.fs = medida; this.pintar(); }
            c.n = 0;
            c.desde = ahora;
        }
        this.agregar(adc);
    },

    ack([cmd, resultado, ...info]) {
        const texto = info.join(',');
        if (resultado === 'OK') {
            if (cmd === 'LED') this.led = Number(texto);
            if (cmd === 'START') this.transmitiendo = true;
            if (cmd === 'STOP') this.transmitiendo = false;
            if (cmd === 'FS') { this.fs = Number(texto); this.dc = null; }
            if (cmd === 'DER') this.derivacion = texto;
            this.pintar();
        }
        const p = this.pendientes.get(cmd);
        if (p) {
            clearTimeout(p.timer);
            this.pendientes.delete(cmd);
            p.resolve({ ok: resultado === 'OK', info: texto });
        }
    },

    // ---------- Envío de comandos ----------
    async comando(cmd, valor) {
        let r;
        if (!this.port || !this.port.writable) r = { ok: false, info: 'Arduino desconectado.' };
        else if (this.formato === 'numeros' || this.formato === 'plotter') r = { ok: false, info: 'El sketch cargado no entiende comandos: sube ecg_plotter_teoria.ino.' };
        else if (this.pendientes.has(cmd)) r = { ok: false, info: 'Comando en curso, espera.' };
        else {
            const respuesta = new Promise((resolve) => {
                const timer = setTimeout(() => {
                    this.pendientes.delete(cmd);
                    resolve({ ok: false, info: 'El Arduino no respondió a tiempo.' });
                }, 2000);
                this.pendientes.set(cmd, { resolve, timer });
            });
            try {
                await this.escribir(valor === undefined ? cmd : `${cmd},${valor}`);
                r = await respuesta;
            } catch (err) {
                const p = this.pendientes.get(cmd);
                if (p) { clearTimeout(p.timer); this.pendientes.delete(cmd); }
                r = { ok: false, info: err.message };
            }
        }
        if (!r.ok) this.pintar(); // revierte los controles al último estado confirmado
        this.registrar(cmd, valor, r);
    },

    registrar(cmd, valor, { ok, info }) {
        const li = document.createElement('li');
        li.className = ok ? 'ok' : 'err';
        li.textContent = `${new Date().toLocaleTimeString()} · ${cmd}${valor === undefined ? '' : ',' + valor} → ${ok ? 'OK' : 'ERROR'} (${info})`;
        this.el.log.prepend(li);
        while (this.el.log.children.length > 8) this.el.log.lastChild.remove();
    },

    // ---------- Interfaz ----------
    fijarActivo(activo, avisar = true) {
        this.active = activo;
        this.queue = [];
        this.el.use.textContent = activo ? 'Volver a la simulación' : 'Mostrar en el monitor';
        this.el.use.classList.toggle('btn-connect', !activo);
        if (activo && avisar) document.dispatchEvent(new CustomEvent('fuente:activa', { detail: this.nombre }));
    },

    habilitar(si) {
        for (const c of [this.el.use, this.el.ping, this.el.led, this.el.streamChk, this.el.selFs, this.el.selDer]) c.disabled = !si;
        this.el.all.hidden = si;
    },

    pintar() {
        this.el.fsTxt.textContent = this.conectado ? `${this.fs} Hz` : '—';
        // Sin las líneas L (LO+/LO− no conectados) el sketch no sabe si hay contacto: se usa el diagnóstico de la señal
        const sinContacto = this.diagnostico === 'sin-contacto';
        this.el.leads.textContent = !this.conectado ? '—'
            : this.sueltos ? '⚠ Sueltos'
            : sinContacto ? '⚠ Sin contacto (solo 60 Hz)'
            : this.leadsMedido ? 'OK'
            : this.diagnostico === 'buena' ? 'Con contacto' : 'Sin verificar';
        this.el.leads.classList.toggle('warn', this.conectado && (this.sueltos || sinContacto));
        if (!this.conectado) this.el.bpm.textContent = '—';
        this.el.led.checked = this.led === 1;
        this.el.streamChk.checked = this.transmitiendo;
        this.el.selFs.value = String(this.fs);
        this.el.der.textContent = this.conectado && this.derivacion ? this.derivacion : '—';
        if (this.derivacion) this.el.selDer.value = this.derivacion;
        const r = this.ritmo;
        this.el.ritmo.textContent = this.conectado && r
            ? `${r.regular ? 'Regular' : 'Irregular'} · ${r.qrsMv !== null ? `${r.qrsMv.toFixed(2)} mV` : '—'}`
            : '—';
    },

    estado(texto, clase = '') {
        this.el.status.textContent = texto;
        this.el.status.classList.toggle('connected', clase === 'connected');
        this.el.status.classList.toggle('error', clase === 'error');
        this.el.status.classList.toggle('warn', clase === 'warn');
    },

    /** Avisos cuando el puerto está abierto pero algo no cuadra (sketch, baudios, electrodos). */
    vigilar() {
        if (!this.conectado || this.cambiandoBaudios) return;
        const ahora = Date.now();
        if (this.validas === 0 && ahora - this.abiertoEn > 5000) { this.probarOtraVelocidad(); return; }
        const silencio = ahora - (this.ultimaLectura || this.abiertoEn);
        if (this.transmitiendo && silencio > 4000) {
            this.estado('Conectado, pero no llegan datos. Revisa que el sketch sea ecg_plotter_teoria.ino y que el Monitor Serie / Plotter esté cerrado.', 'warn');
        } else if (this.sueltos) {
            this.estado('Electrodos sueltos: revisa las almohadillas RA, LA y RL.', 'warn');
        } else if (this.ultimaLectura) {
            const textos = {
                numeros: 'Recibiendo datos de un sketch genérico (sin comandos). Para todas las funciones sube ecg_plotter_teoria.ino.',
                plotter: 'Tu Arduino tiene un sketch antiguo: su frecuencia cardíaca no es confiable y no se muestra. Carga arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino (versión 3) desde el Arduino IDE.',
            };
            if (this.sketchAntiguo()) this.estado(textos[this.formato] || 'Tu Arduino tiene un sketch antiguo: su frecuencia cardíaca no es confiable y no se muestra. Carga arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino (versión 3) desde el Arduino IDE.', 'warn');
            else this.estado(textos[this.formato] || 'Arduino conectado: recibiendo el ECG en tiempo real.', 'connected');
        }
    },

    /** Nada legible en 5 s: el sketch probablemente usa otra velocidad. Se reabre el puerto con la siguiente. */
    async probarOtraVelocidad() {
        const port = this.port;
        if (!port) return;
        this.cambiandoBaudios = true;
        const antes = this.BAUDIOS[this.iBaudios];
        this.iBaudios = (this.iBaudios + 1) % this.BAUDIOS.length;
        this.estado(`No llegan datos legibles a ${antes} baudios; probando ${this.BAUDIOS[this.iBaudios]}…`, 'warn');
        this.cerrando = true;
        try { if (this.reader) await this.reader.cancel(); } catch { /* sin lector */ }
        try { await this.lectura; } catch { /* terminó */ }
        try { await port.close(); } catch { /* ya cerrado */ }
        this.cambiandoBaudios = false;
        this.conectado = false;
        this.port = null;
        try {
            await this.abrir(port);
        } catch (err) {
            this.estado(this.explicar(err), 'error');
            this.el.connect.textContent = 'Conectar Arduino';
            this.el.connect.classList.replace('btn-disconnect', 'btn-connect');
            this.habilitar(false);
        }
    },

    /** Lo que muestra la etiqueta del monitor cuando esta fuente está activa. */
    estadoSenal() {
        if (!this.conectado) return { texto: 'DESCONECTADO', clase: 'error' };
        if (this.sueltos) return { texto: 'ELECTRODOS', clase: 'warn' };
        if (!this.ultimaLectura || Date.now() - this.ultimaLectura > 2500) return { texto: 'SIN DATOS', clase: 'warn' };
        if (this.diagnostico === 'sin-contacto') return { texto: 'SIN CONTACTO', clase: 'warn' };
        return { texto: 'EN VIVO', clase: 'live' };
    },

    explicar(err) {
        const msg = String((err && err.message) || err);
        if (err && (err.name === 'NetworkError' || err.name === 'InvalidStateError' || /failed to open/i.test(msg))) {
            return 'No se pudo abrir el puerto: otro programa lo está usando. Cierra el Monitor Serie / Serial Plotter del Arduino IDE (o el servidor npm start) e inténtalo otra vez.';
        }
        if (err && err.name === 'SecurityError') {
            return 'El navegador bloqueó el acceso USB. Abre la página con https:// o desde localhost.';
        }
        return `No se pudo conectar: ${msg}`;
    },
};

document.addEventListener('DOMContentLoaded', () => UsbSerial.init());
