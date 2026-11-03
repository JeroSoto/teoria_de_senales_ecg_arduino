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
//   PC -> Arduino
//     PING | START | STOP | LED,<0|1> | FS,<125|250|500>
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

const COMANDOS = {
  PING: () => true,
  START: () => true,
  STOP: () => true,
  LED: (v) => v === '0' || v === '1',
  FS: (v) => ['125', '250', '500'].includes(v),
};
const TIMEOUT_ACK_MS = 2000;
const REINTENTO_MS = 3000;

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
    this.estado = {
      modo: config.mode,
      puerto: config.mode === 'serial' ? config.port : 'simulado',
      conectado: false,
      dispositivo: null,
      transmitiendo: true,
      led: 0,
      fs: config.fs,
      bpm: null,
      derivacionesSueltas: false,
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
    if (this.transporte) this.transporte.close();
    for (const p of this.pendientes.values()) clearTimeout(p.timer);
    this.pendientes.clear();
  }

  _conectar() {
    const t =
      this.config.mode === 'serial'
        ? new SerialTransport({ path: this.config.port, baudRate: this.config.baud })
        : new SimulatedArduino({ fs: this.config.fs, countsPerMv: this.config.countsPerMv });
    this.transporte = t;

    t.on('open', () => this._actualizar({ conectado: true, error: null }));
    t.on('line', (l) => this._procesarLinea(l));
    t.on('error', (err) => {
      this._actualizar({ conectado: false, error: err.message });
      this._reintentar();
    });
    t.on('close', () => {
      this._actualizar({ conectado: false });
      this._reintentar();
    });
    t.open();
  }

  _reintentar() {
    if (this.detenido || this.timerReintento) return;
    this.timerReintento = setTimeout(() => {
      this.timerReintento = null;
      if (!this.detenido) this._conectar();
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
    const [tipo, ...resto] = linea.split(',');
    this.estado.ultimaLectura = Date.now();

    switch (tipo) {
      case 'S': {
        const adc = Number(resto[0]);
        if (!Number.isFinite(adc)) return;
        // Quita la componente continua con un promedio móvil exponencial (τ ≈ 1.5 s)
        this.dc = this.dc === null ? adc : this.dc + (adc - this.dc) / (this.estado.fs * 1.5);
        this.lote.push((adc - this.dc) / this.config.countsPerMv); // → mV
        break;
      }
      case 'H': {
        const bpm = Number(resto[0]);
        if (bpm >= 30 && bpm <= 220) {
          this.estado.bpm = bpm;
          this.emit('bpm', bpm);
        }
        break;
      }
      case 'L':
        this._actualizar({ derivacionesSueltas: resto[0] === '1' });
        break;
      case 'I': {
        const fs = /fs=(\d+)/.exec(linea);
        this._actualizar({
          dispositivo: `${resto[0]} v${resto[1] || '?'}`,
          fs: fs ? Number(fs[1]) : this.estado.fs,
        });
        break;
      }
      case 'A':
        this._procesarAck(resto);
        break;
      default:
        break; // líneas desconocidas se ignoran
    }
  }

  _procesarAck([cmd, resultado, ...info]) {
    const texto = info.join(',');
    // Mantiene el estado sincronizado con lo que el Arduino confirma
    if (resultado === 'OK') {
      if (cmd === 'LED') this.estado.led = Number(texto);
      if (cmd === 'START') this.estado.transmitiendo = true;
      if (cmd === 'STOP') this.estado.transmitiendo = false;
      if (cmd === 'FS') this.estado.fs = Number(texto);
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
    if (!this.lote.length) return;
    const samples = this.lote.map((v) => Math.round(v * 1000) / 1000);
    this.lote = [];
    this.emit('samples', { samples, fs: this.estado.fs });
  }

  // ---------- Envío de comandos ----------
  /** Envía un comando validado y espera la confirmación (ACK) del Arduino. */
  enviarComando(comando, valor) {
    const cmd = String(comando || '').toUpperCase();
    const val = valor === undefined || valor === null ? undefined : String(valor);

    if (!COMANDOS[cmd]) return Promise.resolve({ ok: false, info: 'Comando no permitido.' });
    if (!COMANDOS[cmd](val)) return Promise.resolve({ ok: false, info: 'Valor no válido.' });
    if (!this.estado.conectado) return Promise.resolve({ ok: false, info: 'Arduino desconectado.' });
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
