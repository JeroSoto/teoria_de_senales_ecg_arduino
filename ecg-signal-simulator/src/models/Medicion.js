const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Frecuencia cardíaca guardada por un usuario (desde Arduino o simulación)
class Medicion extends Model {}

Medicion.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: false },
    bpm: { type: DataTypes.SMALLINT, allowNull: false, validate: { min: 30, max: 220 } },
    fuente: { type: DataTypes.ENUM('arduino', 'bluetooth', 'simulado'), allowNull: false },
  },
  { sequelize, modelName: 'Medicion', tableName: 'mediciones', updatedAt: false }
);

module.exports = Medicion;
