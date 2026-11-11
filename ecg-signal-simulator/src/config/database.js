// ============================================================
// Conexión a MySQL con Sequelize: XAMPP en local o MySQL en la nube (Vercel)
// ============================================================
const { Sequelize } = require('sequelize');
const mysql2 = require('mysql2');
const mysqlPromesas = require('mysql2/promise');
const env = require('./env');

// Las bases en la nube (TiDB Cloud, Aiven…) exigen conexión cifrada (TLS)
// DB_SSL_VERIFICAR=false acepta certificados propios del servidor (cifra igual, pero sin validar quién responde)
const ssl = env.db.ssl
  ? {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: env.db.sslVerificar !== false,
      ...(env.db.sslCa ? { ca: env.db.sslCa.replace(/\\n/g, '\n') } : {}),
    }
  : undefined;
const enNube = env.entorno === 'nube';

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'mysql',
  // Indicarlo explícitamente hace que Vercel incluya mysql2 en la función (Sequelize lo carga de forma dinámica)
  dialectModule: mysql2,
  dialectOptions: ssl ? { ssl } : {},
  logging: false,
  define: { underscored: true, charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
  // En Vercel cada instancia es pequeña y de vida corta: pocas conexiones
  pool: enNube ? { max: 2, min: 0, acquire: 15000, idle: 5000 } : { max: 8, min: 0, acquire: 15000, idle: 10000 },
});

/** Crea la base de datos si no existe (así no hay que hacerlo a mano en phpMyAdmin). */
async function asegurarBaseDeDatos() {
  const conexion = await mysqlPromesas.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    ssl,
  });
  try {
    const nombre = env.db.name.replace(/[^A-Za-z0-9_]/g, ''); // solo caracteres seguros
    await conexion.query(
      `CREATE DATABASE IF NOT EXISTS \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (err) {
    // Algunos servicios en la nube no dejan crear bases: si ya existe, se sigue sin problema
    if (!/denied|permission/i.test(err.message)) throw err;
  } finally {
    await conexion.end();
  }
}

/** Verifica la conexión y (opcionalmente) sincroniza las tablas con los modelos. */
async function iniciarBaseDeDatos({ sync = env.db.sync } = {}) {
  if (!env.db.configurada) {
    throw new Error(env.db.error || 'Falta DATABASE_URL: configura la base de datos MySQL en la nube.');
  }
  await asegurarBaseDeDatos();
  await sequelize.authenticate();
  require('../models'); // registra modelos y relaciones
  if (sync) await sequelize.sync();
}

/**
 * Para Vercel: prepara la base una sola vez por instancia y reutiliza el resultado.
 * Si falla, se vuelve a intentar en la siguiente petición.
 */
let preparada = null;
function prepararBaseDeDatos() {
  if (!preparada) {
    preparada = iniciarBaseDeDatos().catch((err) => {
      preparada = null;
      throw err;
    });
  }
  return preparada;
}

/** Datos para abrir una conexión mysql2 directa a la misma base (la usa scripts/migrar-a-la-nube.js). */
const opcionesConexion = () => ({
  host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password, database: env.db.name, ssl,
});

module.exports = { sequelize, iniciarBaseDeDatos, asegurarBaseDeDatos, prepararBaseDeDatos, opcionesConexion };
