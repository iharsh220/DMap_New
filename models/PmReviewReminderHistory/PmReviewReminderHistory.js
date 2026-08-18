const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const PmReviewReminderHistory = sequelize.define('PmReviewReminderHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  work_request_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  issue_assignment_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  reminder_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'pm_review_pending',
  },
  items_count: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  items_data: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  email_status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'sent',
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
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
  tableName: 'pm_review_reminder_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = PmReviewReminderHistory;
