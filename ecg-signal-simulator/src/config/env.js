// ============================================================
// Configuración central: lee .env y expone valores con defaults
// ============================================================
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const bool = (v, def = false) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true');
const num = (v, def) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : def);

let jwtSecret = process.env.JWT_SECRET;
const secretInseguro = !jwtSecret || jwtSecret.startsWith('cambia-esto');
if (secretInseguro) {
  // Secreto aleatorio por arranque: seguro, pero las sesiones se cierran al reiniciar el servidor
  jwtSecret = crypto.randomBytes(48).toString('hex');
}

module.exports = {
  port: num(process.env.PORT, 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'arduino_ecg',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    sync: bool(process.env.DB_SYNC, true),
  },
  jwt: {
    secret: jwtSecret,
    secretInseguro,
    expiraHoras: num(process.env.JWT_EXPIRES_HORAS, 8),
  },
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  arduino: {
    mode: (process.env.ARDUINO_MODE || 'serial').toLowerCase(), // 'serial' | 'simulate'
    port: process.env.ARDUINO_PORT || 'auto', // 'auto' busca la placa por USB
    baud: num(process.env.ARDUINO_BAUD, 115200),
    countsPerMv: num(process.env.ARDUINO_COUNTS_PER_MV, 225),
    fs: num(process.env.ARDUINO_FS, 250),
  },
};
