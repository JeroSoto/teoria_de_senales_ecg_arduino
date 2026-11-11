// ============================================================
// Copia tu base actual de XAMPP (usuarios, historial y comandos) a la base MySQL en la nube.
//
//   1. En .env deja los DB_* de XAMPP y agrega DATABASE_URL=mysql://… (la de la nube).
//   2. Enciende MySQL en XAMPP.
//   3. npm run migrar-nube
//
// Crea las tablas en la nube si no existen y copia las filas con el mismo id.
// Se puede ejecutar varias veces: las filas que ya están en la nube no se duplican.
// Al terminar, npm start y la página publicada en Vercel usan la misma base.
// ============================================================
const mysql2 = require('mysql2/promise');
const env = require('../src/config/env');
const { sequelize, iniciarBaseDeDatos, opcionesConexion } = require('../src/config/database');

const TABLAS = ['usuarios', 'mediciones', 'comandos_log']; // en este orden por las claves foráneas
const LOTE = 200;

(async () => {
  if (env.db.origen !== 'DATABASE_URL') {
    console.error('✘ Falta DATABASE_URL en el archivo .env (la dirección de la base MySQL en la nube).');
    process.exit(1);
  }
  const local = env.leerBaseDeDatos({ ...process.env, DATABASE_URL: '', MYSQL_URL: '' });
  console.log(`Origen  (XAMPP): ${local.name} @ ${local.host}:${local.port}`);
  console.log(`Destino (nube) : ${env.db.name} @ ${env.db.host}:${env.db.port}\n`);

  let origen;
  try {
    origen = await mysql2.createConnection({
      host: local.host, port: local.port, user: local.user, password: local.password, database: local.name,
    });
  } catch (err) {
    console.error('✘ No se pudo abrir la base de XAMPP:', err.message);
    console.error('  → Abre XAMPP y pulsa "Start" en MySQL.');
    process.exit(1);
  }

  let destino;
  try {
    await iniciarBaseDeDatos(); // crea la base y las tablas en la nube si hacen falta
    await sequelize.close();
    destino = await mysql2.createConnection(opcionesConexion());
    for (const tabla of TABLAS) {
      const [filas] = await origen.query(`SELECT * FROM \`${tabla}\``);
      const [columnasNube] = await destino.query(`SHOW COLUMNS FROM \`${tabla}\``);
      const columnas = Object.keys(filas[0] || {}).filter((c) => columnasNube.some((n) => n.Field === c));
      let copiadas = 0;
      for (let i = 0; i < filas.length; i += LOTE) {
        const lote = filas.slice(i, i + LOTE);
        const lista = columnas.map((c) => `\`${c}\``).join(', ');
        const marcas = lote.map(() => `(${columnas.map(() => '?').join(', ')})`).join(', ');
        const valores = lote.flatMap((f) => columnas.map((c) => f[c]));
        const [r] = await destino.query(`INSERT IGNORE INTO \`${tabla}\` (${lista}) VALUES ${marcas}`, valores);
        copiadas += r.affectedRows;
      }
      console.log(`✔ ${tabla}: ${filas.length} en XAMPP → ${copiadas} copiadas (${filas.length - copiadas} ya estaban en la nube)`);
    }
    console.log('\nListo. Para que npm start también use la base de la nube, deja DATABASE_URL en .env.');
    process.exit(0);
  } catch (err) {
    console.error('✘ Error al copiar:', err.message);
    process.exit(1);
  } finally {
    await origen.end().catch(() => {});
    if (destino) await destino.end().catch(() => {});
  }
})();
