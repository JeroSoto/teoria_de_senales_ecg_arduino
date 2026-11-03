const { ValidationError, UniqueConstraintError } = require('sequelize');

function noEncontrado(req, res, next) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Ruta no encontrada.' });
  next();
}

// eslint-disable-next-line no-unused-vars
function manejarErrores(err, req, res, next) {
  if (err instanceof UniqueConstraintError) {
    return res.status(409).json({ error: 'Ese correo ya está registrado.' });
  }
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.errors.map((e) => e.message).join(' ') });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
}

module.exports = { noEncontrado, manejarErrores };
