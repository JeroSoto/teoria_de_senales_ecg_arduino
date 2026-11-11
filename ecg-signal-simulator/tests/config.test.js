// Pruebas de la configuración para la nube (Vercel + MySQL remoto) y de la app sin Arduino.
// No necesitan MySQL: si está encendido, la última prueba también verifica ese caso.
const test = require('node:test');
const assert = require('node:assert/strict');
const { leerBaseDeDatos, secretoJwt } = require('../src/config/env');

test('DATABASE_URL: separa host, puerto, usuario, contraseña y base, y activa TLS si no es local', () => {
  const db = leerBaseDeDatos({ DATABASE_URL: 'mysql://abc123.root:p%40ss%3Aword@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/arduino_ecg' });
  assert.equal(db.host, 'gateway01.us-east-1.prod.aws.tidbcloud.com');
  assert.equal(db.port, 4000);
  assert.equal(db.user, 'abc123.root');
  assert.equal(db.password, 'p@ss:word', 'la contraseña se decodifica');
  assert.equal(db.name, 'arduino_ecg');
  assert.equal(db.ssl, true);
  assert.equal(db.configurada, true);
});

test('DATABASE_URL sin nombre de base usa arduino_ecg; en localhost no exige TLS', () => {
  const db = leerBaseDeDatos({ DATABASE_URL: 'mysql://root:clave@127.0.0.1:3306' });
  assert.equal(db.name, 'arduino_ecg');
  assert.equal(db.ssl, false);
  assert.equal(leerBaseDeDatos({ DATABASE_URL: 'mysql://u:p@db.example.com/x', DB_SSL: 'false' }).ssl, false);
});

test('una DATABASE_URL mal escrita da un mensaje claro', () => {
  assert.throws(() => leerBaseDeDatos({ DATABASE_URL: 'esto no es una url' }), /DATABASE_URL no es válida/);
});

test('sin DATABASE_URL usa XAMPP (DB_*), y en Vercel sin base se marca como no configurada', () => {
  const local = leerBaseDeDatos({ DB_HOST: '127.0.0.1', DB_NAME: 'arduino_ecg', DB_USER: 'root' });
  assert.equal(local.host, '127.0.0.1');
  assert.equal(local.configurada, true);
  assert.equal(leerBaseDeDatos({ VERCEL: '1' }).configurada, false);
});

test('el secreto de sesión: JWT_SECRET si existe; si no, derivado de la base (estable entre instancias)', () => {
  const base = leerBaseDeDatos({ DATABASE_URL: 'mysql://u:clave-secreta@db.example.com/arduino_ecg' });
  assert.equal(secretoJwt({ JWT_SECRET: 'mi-secreto' }, base).secret, 'mi-secreto');
  const a = secretoJwt({}, base);
  const b = secretoJwt({}, base);
  assert.equal(a.secret, b.secret, 'dos instancias de Vercel deben firmar igual');
  assert.equal(a.secretInseguro, false);
  assert.notEqual(a.secret, 'clave-secreta');
  assert.equal(secretoJwt({}, { ...base, password: '' }).secretInseguro, true);
});

test('la app de la nube responde config, no tiene Arduino por servidor y no falla si MySQL no está', async () => {
  const { crearAppNube } = require('../src/app');
  const servidor = crearAppNube().listen(0);
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const config = await (await fetch(`${base}/api/config`)).json();
    assert.equal(config.servidor, true);
    assert.equal(config.arduino.modo, 'ninguno');
    assert.equal((await fetch(`${base}/api/arduino/status`)).status, 503);
    // Sin MySQL las cuentas responden 503 (no se cae); con MySQL, "sin sesión" es 401
    const yo = await fetch(`${base}/api/auth/yo`);
    assert.equal(yo.status, config.baseDeDatos ? 401 : 503);
    assert.equal(yo.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise((r) => servidor.close(r));
    await require('../src/config/database').sequelize.close();
  }
});

test('MySQL en línea con campos sueltos (DB_HOST remoto) también va cifrado; DB_SSL_VERIFICAR=false se respeta', () => {
  const remoto = leerBaseDeDatos({ DB_HOST: 'mysql.mihosting.com', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'arduino_ecg' });
  assert.equal(remoto.ssl, true);
  assert.equal(remoto.sslVerificar, true);
  assert.equal(leerBaseDeDatos({ DB_HOST: '127.0.0.1' }).ssl, false, 'XAMPP sigue sin cifrar');
  assert.equal(leerBaseDeDatos({ DATABASE_URL: 'mysql://u:p@db.x.com/a', DB_SSL_VERIFICAR: 'false' }).sslVerificar, false);
  assert.equal(leerBaseDeDatos({ VERCEL: '1', DB_HOST: 'mysql.mihosting.com' }).configurada, true);
});
