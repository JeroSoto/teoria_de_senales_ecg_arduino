// ============================================================
// Gestión de usuarios (solo administradores)
// ============================================================
const express = require('express');
const { Usuario } = require('../models');
const { requiereAuth, requiereRol } = require('../middleware/auth');

const router = express.Router();
router.use(requiereAuth, requiereRol('admin'));

router.get('/usuarios', async (req, res, next) => {
  try {
    const usuarios = await Usuario.findAll({ order: [['id', 'ASC']] });
    res.json({ usuarios: usuarios.map((u) => u.toPublic()) });
  } catch (err) {
    next(err);
  }
});

router.patch('/usuarios/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (id === req.usuario.id) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    }
    const usuario = await Usuario.findByPk(id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
    if (typeof req.body.activo !== 'boolean') {
      return res.status(400).json({ error: 'Se esperaba { "activo": true|false }.' });
    }
    await usuario.update({ activo: req.body.activo });
    res.json({ usuario: usuario.toPublic() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
