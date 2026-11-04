const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

// Saved state of the admin weekly report, one row per division (JSON text in `state`)
const WeeklyReportState = sequelize.define('WeeklyReportState', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  division_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  state: {
    type: DataTypes.TEXT('long'),
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
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
  tableName: 'weekly_report_states',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = WeeklyReportState;
