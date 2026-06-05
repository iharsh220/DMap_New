const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const WorkRequestDeferrals = sequelize.define('WorkRequestDeferrals', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  work_request_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  manager_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  reason: {
    type: DataTypes.ENUM('insufficient_details', 'incorrect_request_type'),
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  old_request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  new_request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  old_project_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  new_project_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  deferred_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  client_resubmitted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  resubmitted_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  resubmission_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
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
  tableName: 'work_request_deferrals',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = WorkRequestDeferrals;
