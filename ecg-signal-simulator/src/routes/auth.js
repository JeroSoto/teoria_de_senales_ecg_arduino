// ============================================================
// Registro, inicio y cierre de sesión
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { Usuario } = require('../models');
const { emitirToken, borrarToken, requiereAuth } = require('../middleware/auth');

const router = express.Router();

// Máximo 20 intentos por IP cada 15 minutos (frena fuerza bruta)
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Hash falso para que el login tarde lo mismo exista o no el correo
const HASH_FALSO = bcrypt.hashSync('contraseña-falsa', 10);

router.post('/registro', limitador, async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (nombre.length < 2 || nombre.length > 80) {
      return res.status(400).json({ error: 'El nombre debe tener entre 2 y 80 caracteres.' });
    }
    if (!EMAIL_RE.test(email) || email.length > 120) {
      return res.status(400).json({ error: 'Correo electrónico inválido.' });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 72 caracteres.' });
    }

    // El primer usuario registrado queda como administrador
    const esPrimero = (await Usuario.count()) === 0;
    const usuario = await Usuario.create({
      nombre,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      rol: esPrimero ? 'admin' : 'usuario',
    });

    emitirToken(res, usuario);
    res.status(201).json({ usuario: usuario.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.post('/login', limitador, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const usuario = await Usuario.findOne({ where: { email } });
    const coincide = await bcrypt.compare(password, usuario ? usuario.passwordHash : HASH_FALSO);

    if (!usuario || !coincide || !usuario.activo) {
      return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    }
    await usuario.update({ ultimoLogin: new Date() });
    emitirToken(res, usuario);
    res.json({ usuario: usuario.toPublic() });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  borrarToken(res);
  res.json({ ok: true });
});

// Devuelve el usuario de la sesión actual (el frontend lo usa al cargar la página)
router.get('/yo', requiereAuth, (req, res) => {
  res.json({ usuario: req.usuario.toPublic() });
});

module.exports = router;
