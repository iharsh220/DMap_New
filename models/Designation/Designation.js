const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Designation = sequelize.define('Designation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  designation_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  designation_category: {
    type: DataTypes.STRING(50),
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
  tableName: 'designation',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Designation;