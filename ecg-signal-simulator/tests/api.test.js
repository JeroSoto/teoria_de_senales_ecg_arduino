// Pruebas de integración de la API: Express + Sequelize + MySQL + SSE
// Requieren MySQL en marcha (XAMPP). Usan una base aparte: arduino_ecg_test.
process.env.DB_NAME = process.env.DB_NAME_TEST || 'arduino_ecg_test';
process.env.AUTH_RATE_LIMIT = '1000';

const test = require('node:test');
const assert = require('node:assert/strict');

const { sequelize, iniciarBaseDeDatos } = require('../src/config/database');
const { Usuario } = require('../src/models');
const ArduinoBridge = require('../src/services/arduinoBridge');
const { crearApp } = require('../src/server');

let servidor, bridge, base, dbOk = false;

const llamar = async (metodo, ruta, { cuerpo, cookie } = {}) => {
  const headers = {};
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie()[0] : null;
  let datos = null;
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, datos, cookie: setCookie ? setCookie.split(';')[0] : null, setCookie };
};

test.before(async () => {
  try {
    await iniciarBaseDeDatos({ sync: false });
    await sequelize.sync({ force: true }); // base de pruebas siempre limpia
    dbOk = true;
  } catch (err) {
    console.warn('MySQL no disponible, se omiten las pruebas de API:', err.message);
    return;
  }
  bridge = new ArduinoBridge({ mode: 'simulate', port: 'sim', baud: 115200, countsPerMv: 225, fs: 250 });
  bridge.iniciar();
  servidor = crearApp(bridge).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(async () => {
  if (bridge) bridge.detener();
  if (servidor) await new Promise((r) => servidor.close(r));
  await sequelize.close();
});

let admin, normal;

test('rutas protegidas devuelven 401 sin sesión', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  for (const ruta of ['/api/arduino/status', '/api/arduino/stream', '/api/mediciones', '/api/admin/usuarios', '/api/auth/yo']) {
    assert.equal((await llamar('GET', ruta)).status, 401, ruta);
  }
  assert.equal((await llamar('POST', '/api/arduino/comando', { cuerpo: { comando: 'LED', valor: 1 } })).status, 401);
});

test('registro: valida datos, el primer usuario es admin y el correo es único', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  assert.equal((await llamar('POST', '/api/auth/registro', { cuerpo: { nombre: 'A', email: 'x', password: '12345678' } })).status, 400);
  assert.equal((await llamar('POST', '/api/auth/registro', { cuerpo: { nombre: 'Ana', email: 'ana@test.com', password: 'corta' } })).status, 400);

  admin = await llamar('POST', '/api/auth/registro', { cuerpo: { nombre: 'Ana Admin', email: 'ANA@test.com', password: 'clave12345' } });
  assert.equal(admin.status, 201);
  assert.equal(admin.datos.usuario.rol, 'admin');
  assert.equal(admin.datos.usuario.email, 'ana@test.com'); // normalizado a minúsculas
  assert.equal(admin.datos.usuario.passwordHash, undefined);
  assert.match(admin.setCookie, /HttpOnly/i);
  assert.match(admin.setCookie, /SameSite=Lax/i);

  normal = await llamar('POST', '/api/auth/registro', { cuerpo: { nombre: 'Beto', email: 'beto@test.com', password: 'clave12345' } });
  assert.equal(normal.datos.usuario.rol, 'usuario');

  assert.equal((await llamar('POST', '/api/auth/registro', { cuerpo: { nombre: 'Otra', email: 'ana@test.com', password: 'clave12345' } })).status, 409);
});

test('la contraseña se guarda con hash bcrypt, nunca en claro', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  const u = await Usuario.findOne({ where: { email: 'ana@test.com' } });
  assert.match(u.passwordHash, /^\$2[aby]\$10\$/);
  assert.notEqual(u.passwordHash, 'clave12345');
});

test('login correcto, incorrecto y SQL injection', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  assert.equal((await llamar('POST', '/api/auth/login', { cuerpo: { email: 'ana@test.com', password: 'mala-clave' } })).status, 401);
  assert.equal((await llamar('POST', '/api/auth/login', { cuerpo: { email: "' OR '1'='1", password: "' OR '1'='1" } })).status, 401);
  assert.equal((await llamar('POST', '/api/auth/login', { cuerpo: { email: 'nadie@test.com', password: 'clave12345' } })).status, 401);
  const ok = await llamar('POST', '/api/auth/login', { cuerpo: { email: 'ana@test.com', password: 'clave12345' } });
  assert.equal(ok.status, 200);
  admin.cookie = ok.cookie;
  const yo = await llamar('GET', '/api/auth/yo', { cookie: admin.cookie });
  assert.equal(yo.datos.usuario.email, 'ana@test.com');
});

test('comandos al Arduino: válidos con ACK, inválidos rechazados y auditados', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  const led = await llamar('POST', '/api/arduino/comando', { cookie: admin.cookie, cuerpo: { comando: 'LED', valor: 1 } });
  assert.equal(led.status, 200);
  assert.equal(led.datos.estado.led, 1);

  assert.equal((await llamar('POST', '/api/arduino/comando', { cookie: admin.cookie, cuerpo: { comando: 'PING' } })).status, 200);
  assert.equal((await llamar('POST', '/api/arduino/comando', { cookie: admin.cookie, cuerpo: { comando: 'FORMAT' } })).status, 422);
  assert.equal((await llamar('POST', '/api/arduino/comando', { cookie: admin.cookie, cuerpo: { comando: 'FS', valor: 7 } })).status, 422);

  const historial = await llamar('GET', '/api/arduino/comandos', { cookie: admin.cookie });
  assert.equal(historial.datos.comandos.length, 4);
  assert.equal(historial.datos.comandos.filter((c) => c.exito).length, 2);

  const estado = await llamar('GET', '/api/arduino/status', { cookie: normal.cookie });
  assert.equal(estado.datos.estado.led, 1, 'el estado es compartido entre usuarios');
});

test('SSE entrega estado y muestras en tiempo real', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/arduino/stream`, { headers: { Cookie: admin.cookie }, signal: ctrl.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let texto = '';
  const limite = Date.now() + 5000;
  while (Date.now() < limite && !(texto.includes('event: status') && texto.includes('event: samples'))) {
    const { value, done } = await lector.read();
    if (done) break;
    texto += dec.decode(value);
  }
  ctrl.abort();
  assert.ok(texto.includes('event: status'), 'falta evento status');
  assert.ok(texto.includes('event: samples'), 'falta evento samples');
  const datos = JSON.parse(/event: samples\ndata: (.*)\n/.exec(texto)[1]);
  assert.ok(Array.isArray(datos.samples) && datos.samples.length > 0);
});

test('mediciones: validación, límite de frecuencia, listado, resumen y borrado', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  const c = admin.cookie;
  assert.equal((await llamar('POST', '/api/mediciones', { cookie: c, cuerpo: { bpm: 500, fuente: 'arduino' } })).status, 400);
  assert.equal((await llamar('POST', '/api/mediciones', { cookie: c, cuerpo: { bpm: 70, fuente: 'otra' } })).status, 400);

  assert.equal((await llamar('POST', '/api/mediciones', { cookie: c, cuerpo: { bpm: 72, fuente: 'arduino' } })).status, 201);
  assert.equal((await llamar('POST', '/api/mediciones', { cookie: c, cuerpo: { bpm: 74, fuente: 'arduino' } })).status, 429);

  const lista = await llamar('GET', '/api/mediciones', { cookie: c });
  assert.equal(lista.datos.mediciones.length, 1);

  const resumen = await llamar('GET', '/api/mediciones/resumen', { cookie: c });
  assert.deepEqual(resumen.datos.resumen[0], { fuente: 'arduino', total: 1, promedio: 72, minimo: 72, maximo: 72 });

  // Un usuario no ve las mediciones de otro
  assert.equal((await llamar('GET', '/api/mediciones', { cookie: normal.cookie })).datos.mediciones.length, 0);

  assert.equal((await llamar('DELETE', '/api/mediciones', { cookie: c })).datos.borradas, 1);
});

test('administración: solo admin, no puede desactivarse a sí mismo y la desactivación cierra la sesión', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  assert.equal((await llamar('GET', '/api/admin/usuarios', { cookie: normal.cookie })).status, 403);

  const lista = await llamar('GET', '/api/admin/usuarios', { cookie: admin.cookie });
  assert.equal(lista.datos.usuarios.length, 2);
  const yo = lista.datos.usuarios.find((u) => u.email === 'ana@test.com');
  const beto = lista.datos.usuarios.find((u) => u.email === 'beto@test.com');

  assert.equal((await llamar('PATCH', `/api/admin/usuarios/${yo.id}`, { cookie: admin.cookie, cuerpo: { activo: false } })).status, 400);
  assert.equal((await llamar('PATCH', `/api/admin/usuarios/${beto.id}`, { cookie: admin.cookie, cuerpo: { activo: false } })).status, 200);

  assert.equal((await llamar('GET', '/api/auth/yo', { cookie: normal.cookie })).status, 401);
  assert.equal((await llamar('POST', '/api/auth/login', { cuerpo: { email: 'beto@test.com', password: 'clave12345' } })).status, 401);
});

test('logout borra la cookie', async (t) => {
  if (!dbOk) return t.skip('MySQL no disponible');
  const r = await llamar('POST', '/api/auth/logout', { cookie: admin.cookie });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /ecg_token=;/);
});
