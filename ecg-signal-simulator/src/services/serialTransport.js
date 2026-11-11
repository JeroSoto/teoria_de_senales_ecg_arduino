// ============================================================
// Transporte serial real (USB) hacia el Arduino con "serialport"
// Misma interfaz que SimulatedArduino: open(), close(), write(), eventos.
//
// ARDUINO_PORT=auto  → busca la placa entre los puertos USB (por fabricante),
//                      así no hay que adivinar si es COM3, COM5…
// ============================================================
const EventEmitter = require('events');

// Fabricantes de los chips USB-serie que usan Arduino y sus clones
const VENDORS_ARDUINO = {
  '2341': 'Arduino',
  '2a03': 'Arduino',
  '1a86': 'CH340 (clon)',
  '0403': 'FTDI',
  '10c4': 'CP210x',
  '239a': 'Adafruit',
  '1b4f': 'SparkFun',
  '03eb': 'Atmel',
  '2e8a': 'Raspberry Pi Pico',
};
const NOMBRES_ARDUINO = /arduino|wch|ch340|ftdi|silicon labs|cp210|usb-serial|usb serial/i;

/**
 * Elige el puerto del Arduino dentro de la lista de SerialPort.list().
 * Descarta los puertos Bluetooth virtuales (BTHENUM), que en Windows aparecen como COM3/COM4.
 * @returns {{ path: string, descripcion: string } | null}
 */
function elegirPuertoArduino(puertos = []) {
  const candidatos = puertos.filter((p) => !/BTHENUM|bluetooth/i.test(`${p.pnpId || ''} ${p.friendlyName || ''}`));
  const porVendor = candidatos.find((p) => VENDORS_ARDUINO[String(p.vendorId || '').toLowerCase()]);
  if (porVendor) {
    return { path: porVendor.path, descripcion: VENDORS_ARDUINO[String(porVendor.vendorId).toLowerCase()] };
  }
  const porNombre = candidatos.find((p) => NOMBRES_ARDUINO.test(`${p.manufacturer || ''} ${p.friendlyName || ''}`));
  return porNombre ? { path: porNombre.path, descripcion: porNombre.manufacturer || 'USB serie' } : null;
}

/** Traduce los errores del sistema operativo a mensajes que explican qué hacer. */
function explicarError(err, path) {
  const msg = String((err && err.message) || err);
  if (/access denied|acceso denegado|resource busy|ebusy|cannot lock|permission denied/i.test(msg)) {
    return `El puerto ${path} está ocupado por otro programa. Cierra el Monitor Serie o el Serial Plotter del Arduino IDE (el IDE puede seguir abierto)`;
  }
  if (/file not found|cannot find|enoent|no such file|no se puede encontrar|not found/i.test(msg)) {
    return `No existe el puerto ${path}. Conecta el Arduino o usa ARDUINO_PORT=auto en .env`;
  }
  return msg;
}

class SerialTransport extends EventEmitter {
  constructor({ path, baudRate }) {
    super();
    this.path = path;
    this.baudRate = baudRate;
    this.port = null;
    this.cerrado = false;
  }

  open() {
    // Cualquier fallo inesperado se informa como evento 'error' (el puente reintenta), nunca como excepción
    this._abrir().catch((err) => this.emit('error', new Error(explicarError(err, this.pathActual || this.path))));
  }

  async _abrir() {
    let SerialPort, ReadlineParser;
    try {
      ({ SerialPort, ReadlineParser } = require('serialport'));
    } catch {
      this.emit('error', new Error('El paquete "serialport" no está instalado (ejecuta npm install).'));
      return;
    }

    let path = this.path;
    if (!path || path.toLowerCase() === 'auto') {
      let elegido = null;
      try {
        elegido = elegirPuertoArduino(await SerialPort.list());
      } catch (err) {
        this.emit('error', new Error(`No se pudieron listar los puertos: ${err.message}`));
        return;
      }
      if (this.cerrado) return;
      if (!elegido) {
        this.emit('error', new Error('No se encontró ningún Arduino conectado por USB. Conéctalo y espera unos segundos'));
        return;
      }
      path = elegido.path;
      this.emit('port', { path, descripcion: elegido.descripcion });
    }
    this.pathActual = path;

    this.port = new SerialPort({ path, baudRate: this.baudRate, autoOpen: false });
    const parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    parser.on('data', (linea) => this.emit('line', linea.trim()));
    this.port.on('close', () => this.emit('close'));
    this.port.on('error', (err) => this.emit('error', new Error(explicarError(err, path))));

    this.port.open((err) => {
      if (err) return this.emit('error', new Error(explicarError(err, path)));
      if (this.cerrado) return this.port.close();
      // Los Arduino Uno se reinician al abrir el puerto; el sketch avisa con "I,..." al arrancar (~2 s)
      this.emit('open');
    });
  }

  close() {
    this.cerrado = true;
    if (this.port && this.port.isOpen) this.port.close();
  }

  write(linea) {
    if (!this.port || !this.port.isOpen) throw new Error('Puerto serial cerrado.');
    this.port.write(linea.trim() + '\n');
  }
}

module.exports = SerialTransport;
module.exports.elegirPuertoArduino = elegirPuertoArduino;
module.exports.explicarError = explicarError;
