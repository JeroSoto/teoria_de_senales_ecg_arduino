// ============================================================
// Autenticación con JWT guardado en una cookie httpOnly
// ============================================================
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { Usuario } = require('../models');

const NOMBRE_COOKIE = 'ecg_token';

function emitirToken(res, usuario) {
  const token = jwt.sign({ sub: usuario.id, rol: usuario.rol }, env.jwt.secret, {
    expiresIn: `${env.jwt.expiraHoras}h`,
  });
  res.cookie(NOMBRE_COOKIE, token, {
    httpOnly: true,            // JavaScript del navegador no puede leerla
    sameSite: 'lax',           // mitiga CSRF
    secure: env.cookieSecure,  // true solo con HTTPS
    maxAge: env.jwt.expiraHoras * 3600 * 1000,
  });
}

function borrarToken(res) {
  res.clearCookie(NOMBRE_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure });
}

/** Exige sesión iniciada; deja el usuario en req.usuario. */
async function requiereAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[NOMBRE_COOKIE];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión.' });

    let payload;
    try {
      payload = jwt.verify(token, env.jwt.secret);
    } catch {
      borrarToken(res);
      return res.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' });
    }

    const usuario = await Usuario.findByPk(payload.sub);
    if (!usuario || !usuario.activo) {
      borrarToken(res);
      return res.status(401).json({ error: 'Usuario inexistente o desactivado.' });
    }
    req.usuario = usuario;
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige un rol concreto (usar después de requiereAuth). */
const requiereRol = (rol) => (req, res, next) =>
  req.usuario && req.usuario.rol === rol
    ? next()
    : res.status(403).json({ error: 'No tienes permisos para esta acción.' });

module.exports = { emitirToken, borrarToken, requiereAuth, requiereRol, NOMBRE_COOKIE };
