// ============================================================
// Puente Arduino <-> servidor
//
// PROTOCOLO (líneas de texto terminadas en \n, 115200 baudios)
//   Arduino -> PC
//     I,<nombre>,<version>,fs=<Hz>   anuncio al arrancar
//     S,<adc>                        muestra del ECG (0-1023)
//     H,<bpm>                        frecuencia cardíaca medida por el Arduino
//     L,<0|1>                        derivaciones sueltas (1 = electrodo desconectado)
//     A,<CMD>,<OK|ERR>[,<info>]      respuesta a un comando
//     R,<rr ms>,<QRS cmV>,<1|0>      ritmo: intervalo RR, amplitud del QRS y si es regular
//     D,<derivación>                 derivación que se está midiendo (I, II, … V6)
//   PC -> Arduino
//     WEB | PING | START | STOP | LED,<0|1> | FS,<125|250|500> | DER,<derivación>
//
//   Sketch del proyecto: arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino. Arranca en modo
//   «gráfica» para el Serial Plotter (líneas II:123,FC:72,Cero:0); al ver ese formato el puente
//   le envía "WEB" y el sketch pasa al protocolo de arriba a 250 Hz.
//
//   Compatibilidad: también se aceptan el formato del Serial Plotter tal cual (si el sketch no
//   entiende "WEB"), sketches que solo hacen Serial.println(analogRead(A0)) y "!" para electrodo
//   suelto. En esos casos la frecuencia de muestreo se estima contando las muestras por segundo.
//   Si no llega nada válido, se prueban otras velocidades (115200 y 9600 baudios).
//
// Eventos que emite este módulo (EventEmitter):
//   'samples' { samples:[mV...], fs }   lotes cada ~40 ms
//   'bpm'     number
//   'status'  objeto de estado
// ============================================================
const EventEmitter = require('events');
const env = require('../config/env');
const SimulatedArduino = require('./simulatedArduino');
const SerialTransport = require('./serialTransport');

const DERIVACIONES = ['I', 'II', 'III', 'AVR', 'AVL', 'AVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
const COMANDOS = {
  DER: (v) => DERIVACIONES.includes(v),
  PING: () => true,
  START: () => true,
  STOP: () => true,
  LED: (v) => v === '0' || v === '1',
  FS: (v) => ['125', '250', '500'].includes(v),
};
const TIMEOUT_ACK_MS = 2000;
const REINTENTO_MS = 3000;
const SIN_DATOS_MS = 3000; // conectado pero sin líneas durante 3 s → aviso
const PROBAR_BAUDIOS_MS = 5000; // sin ninguna línea válida en 5 s → se prueba otra velocidad
const NUMERO = /^-?\d+(\.\d+)?$/;
const PLOTTER = /^[A-Za-z][A-Za-z0-9_]*:-?\d/; // II:123,FC:72,Cero:0

class ArduinoBridge extends EventEmitter {
  constructor(config = env.arduino) {
    super();
    this.config = config;
    this.transporte = null;
    this.pendientes = new Map(); // CMD -> { resolve, timer }
    this.lote = [];
    this.dc = null; // nivel de continua estimado (cuentas ADC)
    this.timerLote = null;
    this.timerReintento = null;
    this.detenido = false;
    this.conteoNumeros = { n: 0, desde: 0 }; // para estimar fs con sketches genéricos
    this.baudios = [...new Set([config.baud, 115200, 9600].filter(Boolean))];
    this.iBaudios = 0;
    this.validas = 0;      // líneas reconocidas desde que se abrió el puerto
    this.abiertoEn = 0;
    this.pedidosWeb = 0;
    this.ultimoPedidoWeb = 0;
    this.estado = {
      modo: config.mode,
      puerto: config.mode === 'serial' ? config.port : 'simulado',
      conectado: false,
      liberado: false,       // true = el usuario soltó el puerto (p. ej. para subir un sketch)
      dispositivo: null,
      formato: null,         // 'protocolo' | 'plotter' | 'numeros'
      baudios: config.mode === 'serial' ? config.baud : null,
      derivacion: null,
      rr: null,
      qrsMv: null,
      ritmoRegular: null,
      transmitiendo: true,
      led: 0,
      fs: config.fs,
      bpm: null,
      derivacionesSueltas: false,
      sinDatos: false,
      ultimaLectura: null,
      error: null,
    };
  }

  iniciar() {
    this.detenido = false;
    this._conectar();
    this.timerLote = setInterval(() => this._vaciarLote(), 40);
  }

  detener() {
    this.detenido = true;
    clearInterval(this.timerLote);
    clearTimeout(this.timerReintento);
    this.timerReintento = null;
    this._cerrarTransporte();
    this._cancelarPendientes('Servidor detenido.');
  }

  /** Suelta el puerto USB para que el Arduino IDE pueda subir un sketch. No reintenta hasta reconectar(). */
  liberarPuerto() {
    clearTimeout(this.timerReintento);
    this.timerReintento = null;
    this._cerrarTransporte();
    this._cancelarPendientes('Puerto liberado.');
    this._actualizar({ conectado: false, liberado: true, error: null, sinDatos: false });
    return this.getEstado();
  }

  /** Vuelve a abrir el puerto después de liberarlo (o fuerza un reintento inmediato). */
  reconectar() {
    clearTimeout(this.timerReintento);
    this.timerReintento = null;
    this._cerrarTransporte();
    this._actualizar({ liberado: false, error: null });
    if (!this.detenido) this._conectar();
    return this.getEstado();
  }

  _cerrarTransporte() {
    const t = this.transporte;
    this.transporte = null;
    if (!t) return;
    t.removeAllListeners();
    t.on('error', () => {}); // un error tardío del puerto viejo no debe tumbar el proceso
    try { t.close(); } catch { /* ya estaba cerrado */ }
  }

  _cancelarPendientes(motivo) {
    for (const p of this.pendientes.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, info: motivo });
    }
    this.pendientes.clear();
  }

  _conectar() {
    this._cerrarTransporte();
    const baudRate = this.baudios[this.iBaudios] || this.config.baud;
    const t =
      this.config.mode === 'serial'
        ? new SerialTransport({ path: this.config.port, baudRate })
        : new SimulatedArduino({ fs: this.config.fs, countsPerMv: this.config.countsPerMv });
    this.transporte = t;
    this.dc = null;
    this.conteoNumeros = { n: 0, desde: 0 };
    this.validas = 0;
    this.pedidosWeb = 0;
    this.ultimoPedidoWeb = 0;
    if (this.config.mode === 'serial') this.estado.baudios = baudRate;

    const vigente = () => this.transporte === t;
    t.on('port', ({ path, descripcion }) => vigente() && this._actualizar({ puerto: `${path} (${descripcion})` }));
    t.on('open', () => {
      if (!vigente()) return;
      this.abiertoEn = Date.now();
      this.estado.ultimaLectura = Date.now();
      this._actualizar({ conectado: true, error: null, sinDatos: false });
    });
    t.on('line', (l) => vigente() && this._procesarLinea(l));
    t.on('error', (err) => {
      if (!vigente()) return;
      this._actualizar({ conectado: false, error: err.message });
      this._reintentar();
    });
    t.on('close', () => {
      if (!vigente()) return;
      this._actualizar({ conectado: false });
      this._reintentar();
    });
    t.open();
  }

  _reintentar() {
    if (this.detenido || this.estado.liberado || this.timerReintento) return;
    this._cancelarPendientes('Arduino desconectado.');
    this.timerReintento = setTimeout(() => {
      this.timerReintento = null;
      if (!this.detenido && !this.estado.liberado) this._conectar();
    }, REINTENTO_MS);
  }

  _actualizar(cambios) {
    Object.assign(this.estado, cambios);
    this.emit('status', this.getEstado());
  }

  getEstado() {
    return { ...this.estado };
  }

  // ---------- Recepción ----------
  _procesarLinea(linea) {
    if (!linea) return;
    if (!this._interpretar(linea)) return; // basura (p. ej. baudios incorrectos): no cuenta como dato
    this.validas++;
    this.estado.ultimaLectura = Date.now();
    if (this.estado.sinDatos) this._actualizar({ sinDatos: false });
  }

  /** @returns {boolean} true si la línea tenía un formato conocido */
  _interpretar(linea) {
    // Sketch genérico: una cifra por línea (Serial.println(analogRead(A0)))
    if (NUMERO.test(linea)) {
      this._muestraGenerica(Number(linea));
      return true;
    }
    if (linea === '!') {
      if (!this.estado.derivacionesSueltas) this._actualizar({ derivacionesSueltas: true });
      return true;
    }
    // Formato del Serial Plotter: II:123,FC:72,Cero:0
    if (PLOTTER.test(linea)) {
      this._lineaPlotter(linea);
      return true;
    }

    const [tipo, ...resto] = linea.split(',');
    switch (tipo) {
      case 'S': {
        const adc = Number(resto[0]);
        if (!Number.isFinite(adc)) return false;
        if (this.estado.formato !== 'protocolo') this._actualizar({ formato: 'protocolo' });
        this._agregarMuestra(adc);
        return true;
      }
      case 'H': {
        const bpm = Number(resto[0]);
        if (!Number.isFinite(bpm)) return false;
        if (bpm >= 30 && bpm <= 220) {
          this.estado.bpm = bpm;
          this.emit('bpm', bpm);
        }
        return true;
      }
      case 'R': {
        const [rr, qrs, regular] = resto.map(Number);
        if (!Number.isFinite(rr)) return false;
        this._actualizar({ rr, qrsMv: Number.isFinite(qrs) ? qrs / 100 : null, ritmoRegular: regular === 1 });
        return true;
      }
      case 'D':
        if (!DERIVACIONES.includes(resto[0])) return false;
        this._actualizar({ derivacion: resto[0] });
        return true;
      case 'L':
        if (resto[0] !== '0' && resto[0] !== '1') return false;
        this._actualizar({ derivacionesSueltas: resto[0] === '1' });
        return true;
      case 'I': {
        if (!resto.length) return false;
        const fs = /fs=(\d+)/.exec(linea);
        this._actualizar({
          dispositivo: `${resto[0]} v${resto[1] || '?'}`,
          formato: 'protocolo',
          fs: fs ? Number(fs[1]) : this.estado.fs,
        });
        this.dc = null;
        return true;
      }
      case 'A':
        if (resto.length < 2) return false;
        this._procesarAck(resto);
        return true;
      default:
        return false; // líneas desconocidas se ignoran
    }
  }

  /** Línea del modo gráfica de ecg_plotter_teoria.ino: la muestra ya viene filtrada y centrada en 0. */
  _lineaPlotter(linea) {
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

    const cambios = {};
    if (this.estado.formato !== 'plotter') {
      cambios.formato = 'plotter';
      cambios.dispositivo = 'ecg_plotter_teoria (modo gráfica)';
    }
    const sueltos = etiqueta === 'SUELTO';
    if (sueltos !== this.estado.derivacionesSueltas) cambios.derivacionesSueltas = sueltos;
    if (!sueltos && DERIVACIONES.includes(etiqueta) && etiqueta !== this.estado.derivacion) cambios.derivacion = etiqueta;
    if (Object.keys(cambios).length) this._actualizar(cambios);

    if (fc >= 30 && fc <= 220 && fc !== this.estado.bpm) {
      this.estado.bpm = fc;
      this.emit('bpm', fc);
    }
    this._pedirModoWeb();
    this._muestraGenerica(muestra, { yaClasificada: true });
  }

  /** Pide al sketch el protocolo completo (250 Hz). Si no lo entiende, se sigue con el formato del Plotter. */
  _pedirModoWeb() {
    const ahora = Date.now();
    if (this.pedidosWeb >= 4 || ahora - this.ultimoPedidoWeb < 2500 || !this.transporte) return;
    this.pedidosWeb++;
    this.ultimoPedidoWeb = ahora;
    try { this.transporte.write('WEB'); } catch { /* puerto cerrándose */ }
  }

  _agregarMuestra(adc) {
    // Quita la componente continua con un promedio móvil exponencial (τ ≈ 1.5 s)
    this.dc = this.dc === null ? adc : this.dc + (adc - this.dc) / (this.estado.fs * 1.5);
    this.lote.push((adc - this.dc) / this.config.countsPerMv); // → mV
  }

  _muestraGenerica(adc, { yaClasificada = false } = {}) {
    const ahora = Date.now();
    const c = this.conteoNumeros;
    if (!yaClasificada) {
      if (this.estado.formato !== 'numeros') {
        this._actualizar({ formato: 'numeros', dispositivo: 'Sketch genérico (Serial.println)' });
      }
      if (this.estado.derivacionesSueltas) this._actualizar({ derivacionesSueltas: false });
    }

    // Estima fs contando muestras en ventanas de 2 s; solo cambia si difiere más de un 10 %
    if (!c.desde) c.desde = ahora;
    c.n++;
    if (ahora - c.desde >= 2000) {
      const fsMedida = Math.round((c.n * 1000) / (ahora - c.desde) / 5) * 5;
      if (fsMedida >= 1 && Math.abs(fsMedida - this.estado.fs) / this.estado.fs > 0.1) {
        this._actualizar({ fs: fsMedida });
      }
      c.n = 0;
      c.desde = ahora;
    }
    this._agregarMuestra(adc);
  }

  _procesarAck([cmd, resultado, ...info]) {
    const texto = info.join(',');
    // Mantiene el estado sincronizado con lo que el Arduino confirma
    if (resultado === 'OK') {
      if (cmd === 'LED') this.estado.led = Number(texto);
      if (cmd === 'START') this.estado.transmitiendo = true;
      if (cmd === 'STOP') this.estado.transmitiendo = false;
      if (cmd === 'FS') { this.estado.fs = Number(texto); this.dc = null; }
      if (cmd === 'DER') this.estado.derivacion = texto;
      this.emit('status', this.getEstado());
    }
    const p = this.pendientes.get(cmd);
    if (p) {
      clearTimeout(p.timer);
      this.pendientes.delete(cmd);
      p.resolve({ ok: resultado === 'OK', info: texto });
    }
  }

  _vaciarLote() {
    // Vigilancia: conectado, transmitiendo y sin líneas durante 3 s → sketch o baudios incorrectos
    const e = this.estado;
    const ahora = Date.now();
    if (e.conectado && this.config.mode === 'serial' && this.validas === 0 && this.baudios.length > 1
        && ahora - this.abiertoEn > PROBAR_BAUDIOS_MS) {
      // Nada legible: probablemente el sketch usa otra velocidad. Se prueba la siguiente.
      const antes = this.baudios[this.iBaudios];
      this.iBaudios = (this.iBaudios + 1) % this.baudios.length;
      this._actualizar({ conectado: false, error: `No llegan datos legibles a ${antes} baudios; probando ${this.baudios[this.iBaudios]}` });
      this._conectar();
      return;
    }
    if (e.conectado && e.transmitiendo && !e.sinDatos && e.ultimaLectura && ahora - e.ultimaLectura > SIN_DATOS_MS) {
      this._actualizar({ sinDatos: true });
    }
    if (!this.lote.length) return;
    const samples = this.lote.map((v) => Math.round(v * 1000) / 1000);
    this.lote = [];
    this.emit('samples', { samples, fs: this.estado.fs });
  }

  // ---------- Envío de comandos ----------
  /** Envía un comando validado y espera la confirmación (ACK) del Arduino. */
  enviarComando(comando, valor) {
    const cmd = String(comando || '').toUpperCase();
    const val = valor === undefined || valor === null ? undefined : String(valor).toUpperCase();

    if (!COMANDOS[cmd]) return Promise.resolve({ ok: false, info: 'Comando no permitido.' });
    if (!COMANDOS[cmd](val)) return Promise.resolve({ ok: false, info: 'Valor no válido.' });
    if (!this.estado.conectado) return Promise.resolve({ ok: false, info: 'Arduino desconectado.' });
    if (this.estado.formato === 'numeros' || this.estado.formato === 'plotter') {
      return Promise.resolve({ ok: false, info: 'El sketch cargado no entiende comandos: sube arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino.' });
    }
    if (this.pendientes.has(cmd)) return Promise.resolve({ ok: false, info: 'Comando en curso, espera.' });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendientes.delete(cmd);
        resolve({ ok: false, info: 'El Arduino no respondió a tiempo.' });
      }, TIMEOUT_ACK_MS);
      this.pendientes.set(cmd, { resolve, timer });
      try {
        this.transporte.write(val === undefined ? cmd : `${cmd},${val}`);
      } catch (err) {
        clearTimeout(timer);
        this.pendientes.delete(cmd);
        resolve({ ok: false, info: err.message });
      }
    });
  }
}

module.exports = ArduinoBridge;
