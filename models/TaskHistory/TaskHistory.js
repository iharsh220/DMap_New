const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const TaskHistory = sequelize.define('TaskHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  work_request_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  action: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  actor_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  actor_type: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  actor_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  actor_email: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  previous_status: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  new_status: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  previous_review: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  new_review: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  previous_review_stage: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  new_review_stage: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  previous_data: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  changes: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  next_data: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  comments: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  related_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  related_user_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  assigned_to_user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  assigned_to_user_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  related_issue_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
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
  tableName: 'task_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = TaskHistory;
