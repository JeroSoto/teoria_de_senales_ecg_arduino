// ============================================================
// Historial de frecuencia cardíaca por usuario
// ============================================================
const express = require('express');
const { fn, col, literal } = require('sequelize');
const { Medicion } = require('../models');
const { requiereAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requiereAuth);

const FUENTES = ['arduino', 'bluetooth', 'simulado'];
const INTERVALO_MIN_MS = 4000; // evita llenar la tabla con demasiadas filas

router.post('/', async (req, res, next) => {
  try {
    const bpm = Math.round(Number(req.body.bpm));
    const fuente = String(req.body.fuente || '');
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) {
      return res.status(400).json({ error: 'bpm debe estar entre 30 y 220.' });
    }
    if (!FUENTES.includes(fuente)) {
      return res.status(400).json({ error: `fuente debe ser una de: ${FUENTES.join(', ')}.` });
    }

    const ultima = await Medicion.findOne({
      where: { usuarioId: req.usuario.id },
      order: [['id', 'DESC']],
    });
    if (ultima && Date.now() - new Date(ultima.createdAt).getTime() < INTERVALO_MIN_MS) {
      return res.status(429).json({ error: 'Guardando demasiado rápido.' });
    }

    const m = await Medicion.create({ usuarioId: req.usuario.id, bpm, fuente });
    res.status(201).json({ medicion: m });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 30, 1), 200);
    const filas = await Medicion.findAll({
      where: { usuarioId: req.usuario.id },
      order: [['id', 'DESC']],
      limit: limite,
    });
    res.json({ mediciones: filas });
  } catch (err) {
    next(err);
  }
});

// Resumen estadístico con funciones de agregación de Sequelize
router.get('/resumen', async (req, res, next) => {
  try {
    const filas = await Medicion.findAll({
      where: { usuarioId: req.usuario.id },
      attributes: [
        'fuente',
        [fn('COUNT', col('id')), 'total'],
        [fn('AVG', col('bpm')), 'promedio'],
        [fn('MIN', col('bpm')), 'minimo'],
        [fn('MAX', col('bpm')), 'maximo'],
      ],
      group: ['fuente'],
      order: [[literal('total'), 'DESC']],
      raw: true,
    });
    res.json({
      resumen: filas.map((f) => ({
        fuente: f.fuente,
        total: Number(f.total),
        promedio: Math.round(Number(f.promedio) * 10) / 10,
        minimo: Number(f.minimo),
        maximo: Number(f.maximo),
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    const borradas = await Medicion.destroy({ where: { usuarioId: req.usuario.id } });
    res.json({ borradas });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
