// Crea un usuario desde la terminal (sin pasar por la web).
//   npm run usuario -- "Nombre Apellido" correo@ejemplo.com Clave1234 [admin|usuario]
const bcrypt = require('bcryptjs');
const { iniciarBaseDeDatos, sequelize } = require('../src/config/database');
const { Usuario } = require('../src/models');

(async () => {
  const [nombre, email, password, rol = 'usuario'] = process.argv.slice(2);
  if (!nombre || !email || !password) {
    console.log('Uso: npm run usuario -- "Nombre" correo@ejemplo.com Clave1234 [admin|usuario]');
    process.exit(1);
  }
  if (password.length < 8 || !['admin', 'usuario'].includes(rol)) {
    console.error('La contraseña necesita 8+ caracteres y el rol debe ser admin o usuario.');
    process.exit(1);
  }
  try {
    await iniciarBaseDeDatos();
    const u = await Usuario.create({
      nombre,
      email: email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 10),
      rol,
    });
    console.log(`✔ Usuario creado: ${u.email} (${u.rol}) id=${u.id}`);
  } catch (err) {
    console.error('✘', err.name === 'SequelizeUniqueConstraintError' ? 'Ese correo ya existe.' : err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
