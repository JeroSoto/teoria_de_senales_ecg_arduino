// ============================================================
// Transporte serial real (USB) hacia el Arduino con "serialport"
// Misma interfaz que SimulatedArduino: open(), close(), write(), eventos.
// ============================================================
const EventEmitter = require('events');

class SerialTransport extends EventEmitter {
  constructor({ path, baudRate }) {
    super();
    this.path = path;
    this.baudRate = baudRate;
    this.port = null;
  }

  open() {
    let SerialPort, ReadlineParser;
    try {
      ({ SerialPort, ReadlineParser } = require('serialport'));
    } catch (err) {
      this.emit('error', new Error('El paquete "serialport" no está instalado (npm install).'));
      return;
    }

    this.port = new SerialPort({ path: this.path, baudRate: this.baudRate, autoOpen: false });
    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (linea) => this.emit('line', linea.trim()));
    this.port.on('close', () => this.emit('close'));
    this.port.on('error', (err) => this.emit('error', err));

    this.port.open((err) => {
      if (err) return this.emit('error', err);
      // Los Arduino Uno se reinician al abrir el puerto; el sketch avisa con "I,..." al arrancar
      this.emit('open');
    });
  }

  close() {
    if (this.port && this.port.isOpen) this.port.close();
  }

  write(linea) {
    if (!this.port || !this.port.isOpen) throw new Error('Puerto serial cerrado.');
    this.port.write(linea.trim() + '\n');
  }
}

module.exports = SerialTransport;
