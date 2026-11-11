// Verifica la conexión a MySQL (XAMPP o en línea) y que Sequelize coincida con las tablas.
//   npm run db:check
const { sequelize, iniciarBaseDeDatos } = require('../src/config/database');
const env = require('../src/config/env');

/** Explica los errores típicos de un MySQL en línea en palabras simples. */
function diagnostico(err) {
  const m = `${err.code || ''} ${err.message || ''}`;
  if (/ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|connect/i.test(m) && env.db.origen === 'DB_*' && ['127.0.0.1', 'localhost'].includes(env.db.host)) {
    return '¿MySQL está iniciado en XAMPP? Pulsa "Start" en MySQL.';
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return 'No existe ese servidor: revisa el host (lo que va después de @ en DATABASE_URL) y tu conexión a Internet.';
  if (/ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH/i.test(m)) {
    return 'El servidor no acepta conexiones desde fuera. En el panel de tu hosting habilita el «acceso remoto» a MySQL para cualquier IP (% o 0.0.0.0/0): Vercel se conecta desde IPs que cambian. Revisa también el puerto.';
  }
  if (/ER_ACCESS_DENIED|Access denied/i.test(m)) {
    return 'Usuario o contraseña incorrectos, o ese usuario no puede conectarse desde fuera (en el hosting debe tener host «%»). Si la contraseña tiene @ : / # ? %, en DATABASE_URL escríbelos como %40 %3A %2F %23 %3F %25.';
  }
  if (/ER_BAD_DB_ERROR|Unknown database/i.test(m)) return 'Esa base no existe y el usuario no puede crearla: créala en el panel del hosting o pon en la URL el nombre de una que ya tengas.';
  if (/self.signed|certificate|unable to verify|CERT_/i.test(m)) {
    return 'El servidor usa un certificado propio. Agrega DB_SSL_VERIFICAR=false (sigue cifrado) o pega su certificado CA en DB_SSL_CA.';
  }
  if (/does not support secure connection|SSL connection error|HANDSHAKE_NO_SSL|ssl/i.test(m)) {
    return 'El servidor no admite conexión cifrada: agrega DB_SSL=false.';
  }
  return env.db.origen === 'DATABASE_URL' ? 'Revisa DATABASE_URL en .env.' : '¿MySQL está iniciado en XAMPP? ¿Los valores DB_* del .env son correctos?';
}

(async () => {
  console.log(`Probando ${env.db.origen === 'DATABASE_URL' ? 'DATABASE_URL' : 'DB_*'}: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.name}` +
    ` · cifrado ${env.db.ssl ? (env.db.sslVerificar === false ? 'sí (sin verificar certificado)' : 'sí') : 'no'}`);
  try {
    await iniciarBaseDeDatos();
    const [[{ version }]] = await sequelize.query('SELECT VERSION() AS version');
    console.log(`✔ Conectado a MySQL ${version} (${env.db.host}:${env.db.port}, base "${env.db.name}")`);

    const { Usuario, Medicion, ComandoLog } = require('../src/models');
    for (const modelo of [Usuario, Medicion, ComandoLog]) {
      const total = await modelo.count(); // falla si faltan tablas o columnas
      console.log(`✔ Tabla ${modelo.getTableName()}: ${total} filas`);
    }
    console.log('Sequelize validado correctamente.');
    process.exit(0);
  } catch (err) {
    console.error('✘ Error:', err.message);
    console.error('  →', diagnostico(err));
    process.exit(1);
  }
})();
