const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Tasks = sequelize.define('Tasks', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  task_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  work_request_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  deadline: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred'),
    defaultValue: 'pending',
  },
  review: {
    type: DataTypes.ENUM('pending', 'approved', 'change_request'),
    defaultValue: 'pending',
    comment: 'Review status - pending, approved, or change_request',
  },
  review_stage: {
    type: DataTypes.ENUM('not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'),
    defaultValue: 'not_started',
    comment: 'Current review stage - not_started, manager_review, pm_review, change_requested, final_approved',
  },
  assignment_type: {
    type: DataTypes.ENUM('new', 'mod'),
    allowNull: false,
    defaultValue: 'new',
    comment: 'new=first time assignment, mod=modification request',
  },
  intimate_team: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
  },
  intimate_client: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '0=not shared with client, 1=shared with client for review',
  },
  task_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
  },
  link: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  end_date: {
    type: DataTypes.DATEONLY,
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
  tableName: 'tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = Tasks;