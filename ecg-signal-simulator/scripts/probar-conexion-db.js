// Verifica la conexión a MySQL y que Sequelize coincida con las tablas.
//   npm run db:check
const { sequelize, iniciarBaseDeDatos } = require('../src/config/database');
const env = require('../src/config/env');

(async () => {
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
    console.error('  → ¿MySQL está iniciado en XAMPP? ¿Los valores DB_* del .env son correctos?');
    process.exit(1);
  }
})();
