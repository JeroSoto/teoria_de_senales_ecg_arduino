// ============================================================
// Configuración central: lee .env y expone valores con defaults
//
// Base de datos, dos formas (la primera que exista gana):
//   DATABASE_URL=mysql://usuario:contraseña@host:puerto/base   ← MySQL en la nube (Vercel)
//   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD        ← XAMPP en tu computador
// ============================================================
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const bool = (v, def = false) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');
const num = (v, def) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : def);
const LOCALES = ['localhost', '127.0.0.1', '::1'];

/**
 * Datos de conexión a MySQL a partir de las variables de entorno.
 * Con DATABASE_URL (lo que dan TiDB Cloud, Aiven, Railway…) se activa SSL automáticamente
 * si el servidor no es local, porque las bases en la nube lo exigen.
 */
function leerBaseDeDatos(e = process.env) {
  const url = e.DATABASE_URL || e.MYSQL_URL || '';
  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error('DATABASE_URL no es válida. Formato: mysql://usuario:contraseña@host:puerto/base');
    }
    const host = u.hostname;
    const nombre = decodeURIComponent(u.pathname.replace(/^\//, '')) || e.DB_NAME || 'arduino_ecg';
    return {
      host,
      port: num(u.port, 3306),
      name: nombre,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      sync: bool(e.DB_SYNC, true),
      ssl: bool(e.DB_SSL, !LOCALES.includes(host)),
      sslVerificar: bool(e.DB_SSL_VERIFICAR, true),
      sslCa: e.DB_SSL_CA || '',
      configurada: true,
      origen: 'DATABASE_URL',
    };
  }
  const host = e.DB_HOST || '127.0.0.1';
  return {
    host,
    port: num(e.DB_PORT, 3306),
    name: e.DB_NAME || 'arduino_ecg',
    user: e.DB_USER || 'root',
    password: e.DB_PASSWORD || '',
    sync: bool(e.DB_SYNC, true),
    // XAMPP (localhost) va sin cifrar; un MySQL en Internet, cifrado salvo que pongas DB_SSL=false
    ssl: bool(e.DB_SSL, !LOCALES.includes(host)),
    sslVerificar: bool(e.DB_SSL_VERIFICAR, true),
    sslCa: e.DB_SSL_CA || '',
    // En Vercel no hay XAMPP: sin DATABASE_URL la base se considera no configurada
    configurada: !(e.VERCEL && !e.DB_HOST),
    origen: 'DB_*',
  };
}

let db;
try {
  db = leerBaseDeDatos();
} catch (err) {
  // Una DATABASE_URL mal escrita no debe tumbar el servidor: la API responde 503 con el motivo
  db = { ...leerBaseDeDatos({ ...process.env, DATABASE_URL: '', MYSQL_URL: '' }), configurada: false, error: err.message };
}

/**
 * Secreto para firmar las sesiones (JWT).
 * 1) JWT_SECRET si está definido;
 * 2) si no, se deriva de la contraseña de la base de datos (así en Vercel basta con DATABASE_URL);
 * 3) si tampoco hay, uno aleatorio por arranque (seguro, pero las sesiones se cierran al reiniciar).
 */
function secretoJwt(e = process.env, base = db) {
  const propio = e.JWT_SECRET;
  if (propio && !propio.startsWith('cambia-esto')) return { secret: propio, secretInseguro: false };
  if (base.password) {
    const derivado = crypto.createHmac('sha256', 'ecg-signal-simulator/jwt').update(`${base.user}:${base.password}@${base.host}/${base.name}`).digest('hex');
    return { secret: derivado, secretInseguro: false };
  }
  return { secret: crypto.randomBytes(48).toString('hex'), secretInseguro: true };
}

const jwt = secretoJwt();
const enVercel = Boolean(process.env.VERCEL);

module.exports = {
  port: num(process.env.PORT, 3000),
  entorno: enVercel ? 'nube' : 'local',
  db,
  jwt: {
    secret: jwt.secret,
    secretInseguro: jwt.secretInseguro,
    expiraHoras: num(process.env.JWT_EXPIRES_HORAS, 8),
  },
  // En Vercel la página va por HTTPS: la cookie de sesión debe ser "secure"
  cookieSecure: bool(process.env.COOKIE_SECURE, enVercel),
  // Correos que serán administradores (separados por comas). Si está vacío, el primer usuario es admin.
  adminEmails: String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  arduino: {
    mode: (process.env.ARDUINO_MODE || 'serial').toLowerCase(), // 'serial' | 'simulate'
    port: process.env.ARDUINO_PORT || 'auto', // 'auto' busca la placa por USB
    baud: num(process.env.ARDUINO_BAUD, 115200),
    countsPerMv: num(process.env.ARDUINO_COUNTS_PER_MV, 225),
    fs: num(process.env.ARDUINO_FS, 250),
  },
  leerBaseDeDatos,
  secretoJwt,
};
