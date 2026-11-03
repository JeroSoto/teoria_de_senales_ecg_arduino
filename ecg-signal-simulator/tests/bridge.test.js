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
