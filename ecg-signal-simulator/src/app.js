// ============================================================
// Aplicación Express (sin arrancar ningún servidor):
//  - npm start (src/server.js): web + API + Arduino por el servidor + MySQL de XAMPP
//  - Vercel (api/index.js en la raíz del repositorio): API de usuarios e historial
//    con MySQL en la nube; el Arduino se conecta por USB desde el navegador.
// Este archivo no carga "serialport", así la función de Vercel queda liviana.
// ============================================================
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const { prepararBaseDeDatos } = require('./config/database');
const { noEncontrado, manejarErrores } = require('./middleware/errorHandler');

/**
 * @param {object|null} bridge  puente con el Arduino (null = sin Arduino por el servidor)
 * @param {{ baseDeDatos?: boolean, perezosa?: boolean, estaticos?: boolean }} opciones
 *   baseDeDatos  false = sin MySQL (las rutas de usuarios responden 503)
 *   perezosa     true  = la base se prepara en la primera petición (Vercel)
 *   estaticos    false = no sirve la carpeta public (en Vercel la sirve su CDN)
 */
function crearApp(bridge, { baseDeDatos = true, perezosa = false, estaticos = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Detrás del proxy de Vercel: la IP real viene en X-Forwarded-For (lo usa el límite de intentos)
  if (env.entorno === 'nube') app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  if (estaticos) app.use(express.static(path.join(__dirname, 'public')));

  /** En Vercel la base se prepara al primer uso; si no responde, la API lo dice con un 503 claro. */
  let ultimoErrorBD = null;
  const conBaseDeDatos = async (req, res, next) => {
    if (!perezosa) return next();
    try {
      await prepararBaseDeDatos();
      ultimoErrorBD = null;
      next();
    } catch (err) {
      ultimoErrorBD = err.message;
      console.error('[base de datos]', err.message);
      res.status(503).json({ error: 'La base de datos no está disponible en este momento. Inténtalo de nuevo en unos segundos.' });
    }
  };

  // Configuración pública (no contiene secretos). Conserva los campos originales.
  app.get('/api/config', async (req, res) => {
    let bdLista = baseDeDatos;
    if (baseDeDatos && perezosa) {
      try {
        await prepararBaseDeDatos();
      } catch (err) {
        bdLista = false;
        ultimoErrorBD = err.message;
      }
    }
    res.json({
      nombreProyecto: 'Simulador ECG & Teoría de Señales',
      servidor: true,
      entorno: env.entorno,
      baseDeDatos: bdLista,
      baseDeDatosConfigurada: env.db.configurada,
      frecuenciaMuestreoHz: 250,
      bpmPorDefecto: 75,
      amplitudPorDefecto: 1.0,
      nivelRuidoPorDefecto: 15,
      arduino: { modo: bridge ? env.arduino.mode : 'ninguno', fs: env.arduino.fs },
    });
  });

  if (baseDeDatos) {
    app.use('/api/auth', conBaseDeDatos, require('./routes/auth'));
    app.use('/api/mediciones', conBaseDeDatos, require('./routes/mediciones'));
    app.use('/api/admin', conBaseDeDatos, require('./routes/admin'));
    if (bridge) {
      app.use('/api/arduino', conBaseDeDatos, require('./routes/arduino')(bridge));
    } else {
      app.use('/api/arduino', (req, res) =>
        res.status(503).json({ error: 'Aquí no hay Arduino por el servidor: conéctalo por USB con el botón «Conectar Arduino».' })
      );
    }
  } else {
    // Sin MySQL no hay usuarios: estas rutas responden 503 y la página pasa al modo web
    // (simulador + conexión USB directa desde el navegador).
    app.use(['/api/auth', '/api/arduino', '/api/mediciones', '/api/admin'], (req, res) =>
      res.status(503).json({ error: 'Base de datos no disponible: abre XAMPP y pulsa "Start" en MySQL.' })
    );
  }

  app.use(noEncontrado);
  app.use(manejarErrores);
  return app;
}

/** La app tal como corre en Vercel: API de usuarios e historial, sin Arduino por el servidor. */
function crearAppNube() {
  return crearApp(null, { baseDeDatos: true, perezosa: true, estaticos: false });
}

module.exports = { crearApp, crearAppNube };
