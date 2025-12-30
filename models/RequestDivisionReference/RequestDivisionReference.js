const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const RequestDivisionReference = sequelize.define('RequestDivisionReference', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  request_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  division_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'request_division_reference',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = RequestDivisionReference;