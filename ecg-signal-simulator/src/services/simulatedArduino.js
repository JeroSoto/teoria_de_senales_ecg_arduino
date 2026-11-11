// ============================================================
// Arduino simulado: habla EXACTAMENTE el mismo protocolo serial
// que el sketch real (arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino en modo web), así el
// resto del sistema no distingue entre hardware y simulación.
// ============================================================
const EventEmitter = require('events');
const EcgModel = require('./ecgModel');

const FS_VALIDAS = [125, 250, 500];

class SimulatedArduino extends EventEmitter {
  constructor({ fs = 250, countsPerMv = 225 } = {}) {
    super();
    this.fs = fs;
    this.countsPerMv = countsPerMv;
    this.streaming = true;
    this.led = 0;
    this.model = new EcgModel(fs, 72);
    this.timer = null;
    this.ultimoTick = 0;
    this.deuda = 0;
    this.latidos = [];
  }

  open() {
    setImmediate(() => {
      this.emit('open');
      this.emit('line', `I,ECG_ARDUINO_SIM,3.0,fs=${this.fs}`);
    });
    this.ultimoTick = Date.now();
    this.timer = setInterval(() => this._tick(), 20);
  }

  close() {
    clearInterval(this.timer);
    this.timer = null;
    this.emit('close');
  }

  // Genera las muestras que "tocan" según el tiempo transcurrido
  _tick() {
    const ahora = Date.now();
    this.deuda += ((ahora - this.ultimoTick) / 1000) * this.fs;
    this.ultimoTick = ahora;
    while (this.deuda >= 1) {
      this.deuda -= 1;
      const mv = this.model.siguiente();
      if (this.model.latido) this._registrarLatido(ahora);
      if (this.streaming) {
        const adc = Math.max(0, Math.min(1023, Math.round(512 + mv * this.countsPerMv)));
        this.emit('line', `S,${adc}`);
      }
    }
  }

  _registrarLatido(ahora) {
    this.latidos.push(ahora);
    if (this.latidos.length > 5) this.latidos.shift();
    if (this.latidos.length >= 3) {
      const rr = (this.latidos[this.latidos.length - 1] - this.latidos[0]) / (this.latidos.length - 1) / 1000;
      this.emit('line', `H,${Math.round(60 / rr)}`);
    }
  }

  /** Recibe una línea de comando (igual que Serial.read() en el Arduino). */
  write(linea) {
    const [cmd, valor] = linea.trim().split(',');
    let resp;
    switch (cmd) {
      case 'PING':
        resp = 'A,PING,OK,pong';
        break;
      case 'START':
        this.streaming = true;
        resp = 'A,START,OK,transmitiendo';
        break;
      case 'STOP':
        this.streaming = false;
        resp = 'A,STOP,OK,en pausa';
        break;
      case 'LED':
        if (valor === '0' || valor === '1') {
          this.led = Number(valor);
          resp = `A,LED,OK,${this.led}`;
        } else resp = 'A,LED,ERR,valor 0 o 1';
        break;
      case 'FS':
        if (FS_VALIDAS.includes(Number(valor))) {
          this.fs = Number(valor);
          this.model.fs = this.fs;
          resp = `A,FS,OK,${this.fs}`;
        } else resp = 'A,FS,ERR,use 125, 250 o 500';
        break;
      default:
        resp = `A,${cmd},ERR,desconocido`;
    }
    setImmediate(() => this.emit('line', resp));
  }
}

module.exports = SimulatedArduino;
