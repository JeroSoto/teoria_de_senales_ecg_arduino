// ============================================================
// Servidor Express: sirve la web, la API REST y el flujo SSE
// ============================================================
const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const { iniciarBaseDeDatos } = require('./config/database');
const ArduinoBridge = require('./services/arduinoBridge');
const { noEncontrado, manejarErrores } = require('./middleware/errorHandler');

function abrirNavegador(url) {
  const comandos = {
    win32: ['explorer.exe', [url]],
    darwin: ['open', [url]],
    linux: ['xdg-open', [url]],
  };
  const comando = comandos[process.platform];

  if (!comando) {
    console.warn(`[navegador] Apertura automática no disponible. Abre ${url}`);
    return;
  }

  const proceso = spawn(comando[0], comando[1], { detached: true, stdio: 'ignore' });
  proceso.once('error', (err) => {
    console.warn(`[navegador] No se pudo abrir automáticamente: ${err.message}`);
    console.warn(`[navegador] Abre ${url} manualmente.`);
  });
  proceso.unref();
}

function crearApp(bridge) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use(express.static(path.join(__dirname, 'public')));

  // Configuración pública (no contiene secretos). Conserva los campos originales.
  app.get('/api/config', (req, res) => {
    res.json({
      nombreProyecto: 'Simulador ECG & Teoría de Señales',
      frecuenciaMuestreoHz: 250,
      bpmPorDefecto: 75,
      amplitudPorDefecto: 1.0,
      nivelRuidoPorDefecto: 15,
      arduino: { modo: env.arduino.mode, fs: env.arduino.fs },
    });
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/arduino', require('./routes/arduino')(bridge));
  app.use('/api/mediciones', require('./routes/mediciones'));
  app.use('/api/admin', require('./routes/admin'));

  app.use(noEncontrado);
  app.use(manejarErrores);
  return app;
}

async function iniciar() {
  try {
    await iniciarBaseDeDatos();
  } catch (err) {
    console.error('\n[ERROR] No se pudo conectar a MySQL:', err.message);
    console.error('  → Abre XAMPP y pulsa "Start" en MySQL, y revisa DB_* en el archivo .env\n');
    process.exit(1);
  }

  const bridge = new ArduinoBridge();
  bridge.on('status', (e) => {
    if (e.error) console.warn(`[arduino] ${e.error} (reintentando…)`);
  });
  bridge.iniciar();

  const app = crearApp(bridge);
  const servidor = app.listen(env.port, () => {
    const url = `http://localhost:${env.port}`;
    console.log('====================================================');
    console.log('Servidor ECG iniciado correctamente.');
    console.log(`Accede en tu navegador a: ${url}`);
    console.log(`Base de datos: ${env.db.name} @ ${env.db.host}:${env.db.port}`);
    console.log(`Arduino: modo ${env.arduino.mode}${env.arduino.mode === 'serial' ? ` (${env.arduino.port})` : ''}`);
    if (env.jwt.secretInseguro) console.log('Aviso: define JWT_SECRET en .env (se usa uno temporal).');
    console.log('====================================================');
    abrirNavegador(url);
  });

  const cerrar = () => {
    bridge.detener();
    servidor.close(() => process.exit(0));
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
  return { app, servidor, bridge };
}

if (require.main === module) iniciar();

module.exports = { crearApp, iniciar };
