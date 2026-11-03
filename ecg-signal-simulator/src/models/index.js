// Registro de modelos y relaciones
const { sequelize } = require('../config/database');
const Usuario = require('./Usuario');
const Medicion = require('./Medicion');
const ComandoLog = require('./ComandoLog');

Usuario.hasMany(Medicion, { foreignKey: 'usuarioId', onDelete: 'CASCADE' });
Medicion.belongsTo(Usuario, { foreignKey: 'usuarioId' });

Usuario.hasMany(ComandoLog, { foreignKey: 'usuarioId', onDelete: 'CASCADE' });
ComandoLog.belongsTo(Usuario, { foreignKey: 'usuarioId' });

module.exports = { sequelize, Usuario, Medicion, ComandoLog };
