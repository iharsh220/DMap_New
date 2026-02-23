const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const TaskReviewHistory = sequelize.define('TaskReviewHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  reviewer_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  reviewer_type: {
    type: DataTypes.ENUM('manager', 'project_manager'),
    allowNull: false,
    comment: 'manager=creative manager, project_manager=requester',
  },
  action: {
    type: DataTypes.ENUM('approved', 'change_request'),
    allowNull: false,
    comment: 'Review action taken',
  },
  comments: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Review comments or change request details',
  },
  previous_stage: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Previous review stage',
  },
  new_stage: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'New review stage after action',
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
  tableName: 'task_review_history',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = TaskReviewHistory;
