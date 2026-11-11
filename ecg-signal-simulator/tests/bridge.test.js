// Pruebas del puente Arduino (sin base de datos): protocolo, comandos y conversión a mV
const test = require('node:test');
const assert = require('node:assert/strict');
const ArduinoBridge = require('../src/services/arduinoBridge');

const config = { mode: 'simulate', port: 'sim', baud: 115200, countsPerMv: 225, fs: 250 };
const esperar = (emisor, evento, ms = 4000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout esperando "${evento}"`)), ms);
    emisor.once(evento, (d) => { clearTimeout(t); resolve(d); });
  });

test('el puente recibe muestras en mV, BPM y estado del Arduino simulado', async () => {
  const bridge = new ArduinoBridge(config);
  bridge.iniciar();
  try {
    const lote = await esperar(bridge, 'samples');
    assert.ok(lote.samples.length > 0);
    assert.equal(lote.fs, 250);
    assert.ok(lote.samples.every((v) => Math.abs(v) < 5), 'las muestras deben estar en mV razonables');

    const bpm = await esperar(bridge, 'bpm', 6000);
    assert.ok(bpm >= 60 && bpm <= 85, `BPM simulado fuera de rango: ${bpm}`);
    assert.equal(bridge.getEstado().conectado, true);
  } finally {
    bridge.detener();
  }
});

test('los comandos válidos reciben ACK y actualizan el estado', async () => {
  const bridge = new ArduinoBridge(config);
  bridge.iniciar();
  try {
    await esperar(bridge, 'samples');
    assert.deepEqual(await bridge.enviarComando('PING'), { ok: true, info: 'pong' });

    const led = await bridge.enviarComando('led', 1);
    assert.equal(led.ok, true);
    assert.equal(bridge.getEstado().led, 1);

    assert.equal((await bridge.enviarComando('FS', 125)).ok, true);
    assert.equal(bridge.getEstado().fs, 125);

    assert.equal((await bridge.enviarComando('STOP')).ok, true);
    assert.equal(bridge.getEstado().transmitiendo, false);
  } finally {
    bridge.detener();
  }
});

test('los comandos no permitidos o con valores inválidos se rechazan sin llegar al Arduino', async () => {
  const bridge = new ArduinoBridge(config);
  bridge.iniciar();
  try {
    await esperar(bridge, 'samples');
    assert.equal((await bridge.enviarComando('FORMAT')).ok, false);
    assert.equal((await bridge.enviarComando('LED', 7)).ok, false);
    assert.equal((await bridge.enviarComando('FS', 9999)).ok, false);
    assert.equal((await bridge.enviarComando('LED;rm -rf', 1)).ok, false);
  } finally {
    bridge.detener();
  }
});

test('sin conexión no se envían comandos', async () => {
  const bridge = new ArduinoBridge(config); // sin iniciar()
  const r = await bridge.enviarComando('PING');
  assert.equal(r.ok, false);
  assert.match(r.info, /desconectado/i);
});

test('el analizador de líneas ignora basura y detecta electrodos sueltos', async () => {
  const bridge = new ArduinoBridge(config);
  bridge._procesarLinea('ruido sin formato');
  bridge._procesarLinea('S,no-es-numero');
  bridge._procesarLinea('H,999'); // fuera de 30-220
  assert.equal(bridge.getEstado().bpm, null);
  bridge._procesarLinea('L,1');
  assert.equal(bridge.getEstado().derivacionesSueltas, true);
  bridge._procesarLinea('L,0');
  assert.equal(bridge.getEstado().derivacionesSueltas, false);
});

test('entiende el modo gráfica de ecg_plotter_teoria.ino y le pide el modo web', () => {
  const bridge = new ArduinoBridge(config);
  const escritos = [];
  bridge.transporte = { write: (l) => escritos.push(l) };
  bridge._procesarLinea('II:123,FC:72,Cero:0');
  const e = bridge.getEstado();
  assert.equal(e.formato, 'plotter');
  assert.equal(e.derivacion, 'II');
  assert.equal(e.bpm, null, 'la FC del formato del Plotter (sketch antiguo) no se usa');
  assert.equal(e.sketchAntiguo, true);
  assert.deepEqual(escritos, ['WEB'], 'debe pedir el protocolo completo');
  assert.equal(bridge.lote.length, 1);
  bridge._procesarLinea('SUELTO:0,FC:0,Cero:0');
  assert.equal(bridge.getEstado().derivacionesSueltas, true);
});

test('lee derivación, ritmo y amplitud del QRS del sketch en modo web', () => {
  const bridge = new ArduinoBridge(config);
  bridge._procesarLinea('I,ECG_PLOTTER_TEORIA,2.0,fs=250');
  bridge._procesarLinea('D,V2');
  bridge._procesarLinea('R,820,105,1');
  const e = bridge.getEstado();
  assert.equal(e.formato, 'protocolo');
  assert.equal(e.fs, 250);
  assert.equal(e.derivacion, 'V2');
  assert.equal(e.rr, 820);
  assert.equal(e.qrsMv, 1.05);
  assert.equal(e.ritmoRegular, true);
  bridge._procesarLinea('D,XX'); // derivación inexistente: se ignora
  assert.equal(bridge.getEstado().derivacion, 'V2');
});

test('las líneas basura no cuentan como datos (sirve para detectar baudios incorrectos)', () => {
  const bridge = new ArduinoBridge(config);
  bridge._procesarLinea('\u00ff\u00fe?x');
  bridge._procesarLinea('S,abc');
  assert.equal(bridge.validas, 0);
  bridge._procesarLinea('S,512');
  assert.equal(bridge.validas, 1);
});

test('DER se valida y se normaliza a mayúsculas', async () => {
  const bridge = new ArduinoBridge(config);
  bridge.estado.conectado = true;
  bridge.estado.formato = 'protocolo';
  let enviado = null;
  bridge.transporte = { write: (l) => { enviado = l; setImmediate(() => bridge._procesarLinea('A,DER,OK,AVF')); } };
  assert.equal((await bridge.enviarComando('DER', 'X9')).ok, false);
  const r = await bridge.enviarComando('der', 'avf');
  assert.equal(enviado, 'DER,AVF');
  assert.equal(r.ok, true);
  assert.equal(bridge.getEstado().derivacion, 'AVF');
});

test('liberar el puerto detiene los reintentos y reconectar vuelve a abrirlo', async () => {
  const bridge = new ArduinoBridge(config);
  bridge.iniciar();
  try {
    await esperar(bridge, 'samples');
    const libre = bridge.liberarPuerto();
    assert.equal(libre.liberado, true);
    assert.equal(libre.conectado, false);
    assert.equal(bridge.transporte, null);
    bridge.reconectar();
    await esperar(bridge, 'samples');
    assert.equal(bridge.getEstado().conectado, true);
    assert.equal(bridge.getEstado().liberado, false);
  } finally {
    bridge.detener();
  }
});

test('ARDUINO_PORT=auto elige la placa USB e ignora los puertos Bluetooth', () => {
  const { elegirPuertoArduino } = require('../src/services/serialTransport');
  const bt = { path: 'COM3', manufacturer: 'Microsoft', pnpId: 'BTHENUM\{00001101}', friendlyName: 'Serie estándar sobre el vínculo Bluetooth (COM3)' };
  assert.equal(elegirPuertoArduino([bt]), null);
  assert.equal(elegirPuertoArduino([bt, { path: 'COM7', vendorId: '2341', productId: '0043' }]).path, 'COM7');
  assert.equal(elegirPuertoArduino([bt, { path: 'COM9', vendorId: '1A86', productId: '7523' }]).descripcion, 'CH340 (clon)');
  assert.equal(elegirPuertoArduino([{ path: '/dev/ttyUSB0', manufacturer: 'FTDI' }]).path, '/dev/ttyUSB0');
});

test('H,0 del sketch borra el BPM (ya no hay una medición confiable)', () => {
  const bridge = new ArduinoBridge(config);
  bridge._procesarLinea('H,72');
  assert.equal(bridge.getEstado().bpm, 72);
  bridge._procesarLinea('H,0');
  assert.equal(bridge.getEstado().bpm, null);
});

test('la FC de un sketch anterior a la v3 se ignora (contaba la onda T y daba ~200 lpm)', () => {
  const viejo = new ArduinoBridge(config);
  viejo._procesarLinea('I,ECG_PLOTTER_TEORIA,2.0,fs=250');
  viejo._procesarLinea('H,192');
  assert.equal(viejo.getEstado().sketchAntiguo, true);
  assert.equal(viejo.getEstado().bpm, null);
  const nuevo = new ArduinoBridge(config);
  nuevo._procesarLinea('I,ECG_PLOTTER_TEORIA,3.0,fs=250');
  nuevo._procesarLinea('H,74');
  assert.equal(nuevo.getEstado().sketchAntiguo, false);
  assert.equal(nuevo.getEstado().bpm, 74);
});
