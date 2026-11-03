const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');

class Usuario extends Model {
  /** Datos seguros para enviar al navegador (nunca el hash de la contraseña). */
  toPublic() {
    return {
      id: this.id,
      nombre: this.nombre,
      email: this.email,
      rol: this.rol,
      activo: this.activo,
      ultimoLogin: this.ultimoLogin,
      creadoEn: this.createdAt,
    };
  }
}

Usuario.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    nombre: {
      type: DataTypes.STRING(80),
      allowNull: false,
      validate: { len: [2, 80] },
    },
    email: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false },
    rol: { type: DataTypes.ENUM('admin', 'usuario'), allowNull: false, defaultValue: 'usuario' },
    activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ultimoLogin: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, modelName: 'Usuario', tableName: 'usuarios' }
);

module.exports = Usuario;
