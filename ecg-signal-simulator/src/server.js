// ============================================================
// Servidor Express: sirve la web, la API REST y el flujo SSE
// ============================================================
const express = require('express');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const { iniciarBaseDeDatos } = require('./config/database');
const ArduinoBridge = require('./services/arduinoBridge');
const { noEncontrado, manejarErrores } = require('./middleware/errorHandler');

function abrirNavegador(url) {
  if (process.env.NO_ABRIR_NAVEGADOR === 'true') return;
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

/** Direcciones IPv4 de la red local: sirven para abrir la página desde un celular en el mismo Wi-Fi. */
function direccionesLocales() {
  const virtual = /virtual|vmware|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth/i;
  const todas = Object.entries(os.networkInterfaces()).flatMap(([nombre, lista]) =>
    (lista || []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => ({ nombre, ip: i.address }))
  );
  const reales = todas.filter((d) => !virtual.test(d.nombre));
  return (reales.length ? reales : todas).map((d) => d.ip);
}

/**
 * @param {ArduinoBridge|null} bridge  puente con el Arduino (null si no hay base de datos)
 * @param {{ baseDeDatos?: boolean }} opciones
 */
function crearApp(bridge, { baseDeDatos = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    next();
  });

  app.use(express.static(path.join(__dirname, 'public')));

  // Configuración pública (no contiene secretos). Conserva los campos originales.
  app.get('/api/config', (req, res) => {
    res.json({
      nombreProyecto: 'Simulador ECG & Teoría de Señales',
      servidor: true,
      baseDeDatos,
      frecuenciaMuestreoHz: 250,
      bpmPorDefecto: 75,
      amplitudPorDefecto: 1.0,
      nivelRuidoPorDefecto: 15,
      arduino: { modo: bridge ? env.arduino.mode : 'ninguno', fs: env.arduino.fs },
    });
  });

  if (baseDeDatos && bridge) {
    app.use('/api/auth', require('./routes/auth'));
    app.use('/api/arduino', require('./routes/arduino')(bridge));
    app.use('/api/mediciones', require('./routes/mediciones'));
    app.use('/api/admin', require('./routes/admin'));
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

async function iniciar() {
  let baseDeDatos = true;
  try {
    await iniciarBaseDeDatos();
  } catch (err) {
    baseDeDatos = false;
    console.warn('\n[AVISO] No se pudo conectar a MySQL:', err.message);
    console.warn('  → Abre XAMPP y pulsa "Start" en MySQL, y revisa DB_* en el archivo .env.');
    console.warn('  → El servidor arranca igual: simulador y conexión USB directa desde el navegador');
    console.warn('    (Chrome/Edge). Sesión, historial y Arduino por el servidor quedan desactivados.\n');
  }

  let bridge = null;
  if (baseDeDatos) {
    bridge = new ArduinoBridge();
    let ultimoAviso = '';
    bridge.on('status', (e) => {
      // Solo se imprime cuando cambia el mensaje, para no llenar la consola cada 3 s
      const aviso = e.liberado
        ? 'Puerto liberado: ya puedes subir el sketch desde el Arduino IDE.'
        : e.error
          ? `${e.error} (reintentando…)`
          : e.conectado
            ? `Conectado ${e.modo === 'serial' ? `a ${e.puerto}` : 'al Arduino simulado'}${e.dispositivo ? ` · ${e.dispositivo}` : ''}`
            : '';
      if (aviso && aviso !== ultimoAviso) console.log(`[arduino] ${aviso}`);
      ultimoAviso = aviso || ultimoAviso;
    });
    bridge.iniciar();
  }

  const app = crearApp(bridge, { baseDeDatos });
  const servidor = app.listen(env.port, () => {
    const url = `http://localhost:${env.port}`;
    console.log('====================================================');
    console.log('Servidor ECG iniciado correctamente.');
    console.log(`Accede en tu navegador a: ${url}`);
    for (const ip of direccionesLocales()) console.log(`Desde un celular en la misma red Wi-Fi: http://${ip}:${env.port}`);
    console.log(baseDeDatos ? `Base de datos: ${env.db.name} @ ${env.db.host}:${env.db.port}` : 'Base de datos: NO disponible (modo web)');
    if (bridge) {
      const puerto = env.arduino.port.toLowerCase() === 'auto' ? 'detección automática' : env.arduino.port;
      console.log(`Arduino: modo ${env.arduino.mode}${env.arduino.mode === 'serial' ? ` (${puerto})` : ''}`);
      if (env.arduino.mode === 'serial') console.log('Recuerda: cierra el Monitor Serie / Serial Plotter del Arduino IDE.');
    }
    if (env.jwt.secretInseguro) console.log('Aviso: define JWT_SECRET en .env (se usa uno temporal).');
    console.log('====================================================');
    abrirNavegador(url);
  });

  servidor.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[ERROR] El puerto ${env.port} ya está en uso: probablemente el servidor ya está abierto en otra terminal.`);
      console.error(`  → Ciérralo (Ctrl + C) o cambia PORT en .env.\n`);
    } else {
      console.error('\n[ERROR] El servidor no pudo iniciar:', err.message);
    }
    if (bridge) bridge.detener();
    process.exit(1);
  });

  const cerrar = () => {
    if (bridge) bridge.detener();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref(); // las conexiones SSE abiertas no deben bloquear el cierre
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
  return { app, servidor, bridge };
}

if (require.main === module) iniciar();

module.exports = { crearApp, iniciar };
