// ============================================================
// API del Arduino: estado, comandos y flujo en tiempo real (SSE)
// Todas las rutas exigen sesión iniciada.
// ============================================================
const express = require('express');
const { ComandoLog } = require('../models');
const { requiereAuth } = require('../middleware/auth');

module.exports = function crearRutasArduino(bridge) {
  const router = express.Router();
  router.use(requiereAuth);

  router.get('/status', (req, res) => res.json({ estado: bridge.getEstado() }));

  router.post('/comando', async (req, res, next) => {
    try {
      const { comando, valor } = req.body || {};
      const r = await bridge.enviarComando(comando, valor);
      await ComandoLog.create({
        usuarioId: req.usuario.id,
        comando: String(comando || '').toUpperCase().slice(0, 20),
        valor: valor === undefined ? null : String(valor).slice(0, 20),
        exito: r.ok,
        respuesta: String(r.info || '').slice(0, 160),
      });
      res.status(r.ok ? 200 : 422).json({ ok: r.ok, info: r.info, estado: bridge.getEstado() });
    } catch (err) {
      next(err);
    }
  });

  // Libera el puerto USB (para que el Arduino IDE pueda subir un sketch) o lo vuelve a abrir
  router.post('/puerto', async (req, res, next) => {
    try {
      const accion = String((req.body && req.body.accion) || '');
      if (!['liberar', 'conectar'].includes(accion)) {
        return res.status(400).json({ ok: false, info: 'accion debe ser "liberar" o "conectar".' });
      }
      const estado = accion === 'liberar' ? bridge.liberarPuerto() : bridge.reconectar();
      await ComandoLog.create({
        usuarioId: req.usuario.id,
        comando: 'PUERTO',
        valor: accion,
        exito: true,
        respuesta: accion === 'liberar' ? 'puerto liberado' : 'reconectando',
      });
      res.json({ ok: true, info: accion === 'liberar' ? 'Puerto liberado.' : 'Reconectando…', estado });
    } catch (err) {
      next(err);
    }
  });

  router.get('/comandos', async (req, res, next) => {
    try {
      const filas = await ComandoLog.findAll({
        where: { usuarioId: req.usuario.id },
        order: [['id', 'DESC']],
        limit: 15,
      });
      res.json({ comandos: filas });
    } catch (err) {
      next(err);
    }
  });

  // Server-Sent Events: el navegador recibe muestras, BPM y estado en tiempo real
  router.get('/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const enviar = (evento, datos) => res.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);

    const alMuestras = (d) => enviar('samples', d);
    const alBpm = (bpm) => enviar('bpm', { bpm });
    const alEstado = (e) => enviar('status', e);

    bridge.on('samples', alMuestras);
    bridge.on('bpm', alBpm);
    bridge.on('status', alEstado);
    enviar('status', bridge.getEstado()); // estado inicial

    const latido = setInterval(() => res.write(': keep-alive\n\n'), 15000);

    req.on('close', () => {
      clearInterval(latido);
      bridge.off('samples', alMuestras);
      bridge.off('bpm', alBpm);
      bridge.off('status', alEstado);
    });
  });

  return router;
};
