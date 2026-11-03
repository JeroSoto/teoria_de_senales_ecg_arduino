// ============================================================
// Conexión a MySQL (XAMPP) con Sequelize
// ============================================================
const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');
const env = require('./env');

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'mysql',
  logging: false,
  define: { underscored: true, charset: 'utf8mb4', collate: 'utf8mb4_unicode_ci' },
  pool: { max: 8, min: 0, acquire: 15000, idle: 10000 },
});

/** Crea la base de datos si no existe (así no hay que hacerlo a mano en phpMyAdmin). */
async function asegurarBaseDeDatos() {
  const conexion = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
  });
  try {
    const nombre = env.db.name.replace(/[^A-Za-z0-9_]/g, ''); // solo caracteres seguros
    await conexion.query(
      `CREATE DATABASE IF NOT EXISTS \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conexion.end();
  }
}

/** Verifica la conexión y (opcionalmente) sincroniza las tablas con los modelos. */
async function iniciarBaseDeDatos({ sync = env.db.sync } = {}) {
  await asegurarBaseDeDatos();
  await sequelize.authenticate();
  require('../models'); // registra modelos y relaciones
  if (sync) await sequelize.sync();
}

module.exports = { sequelize, iniciarBaseDeDatos, asegurarBaseDeDatos };
