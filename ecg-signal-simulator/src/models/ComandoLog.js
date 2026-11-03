const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

// Auditoría: qué usuario envió qué comando al Arduino y qué respondió
class ComandoLog extends Model {}

ComandoLog.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    usuarioId: { type: DataTypes.INTEGER, allowNull: false },
    comando: { type: DataTypes.STRING(20), allowNull: false },
    valor: { type: DataTypes.STRING(20), allowNull: true },
    exito: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    respuesta: { type: DataTypes.STRING(160), allowNull: true },
  },
  { sequelize, modelName: 'ComandoLog', tableName: 'comandos_log', updatedAt: false }
);

module.exports = ComandoLog;
