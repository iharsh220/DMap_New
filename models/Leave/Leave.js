const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');
const User = require('../User/User');

const Leave = sequelize.define('Leave', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  date: {
    type: DataTypes.DATE,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  leave_day_type: {
    type: DataTypes.ENUM('Full day', 'Half day', 'Short Leave'),
    allowNull: false,
    defaultValue: 'Full day',
  },
  leave_type: {
    type: DataTypes.ENUM('Unplanned', 'Planned'),
    allowNull: false,
    defaultValue: 'Unplanned',
  },
  status: {
    type: DataTypes.ENUM('Inform', 'Not Inform'),
    allowNull: false,
    defaultValue: 'Inform',
  },
  leave_reason: {
    type: DataTypes.ENUM('Emergency', 'Medical', 'Family Emergency', 'Feeling not well', 'Go Early', 'Personal', 'Hospitalized'),
    allowNull: false,
    defaultValue: 'Feeling not well',
  },
  remark: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  day: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  month: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  vertical: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  days_count: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: true,
    defaultValue: 1.0,
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  is_deleted: {
    type: DataTypes.TINYINT(1),
    allowNull: false,
    defaultValue: 0,
    comment: 'Soft delete flag - 0=active, 1=deleted',
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'leaves',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = Leave;
