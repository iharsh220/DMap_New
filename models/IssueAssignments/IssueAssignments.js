const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const IssueAssignments = sequelize.define('IssueAssignments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Linked to tasks table',
  },
  requested_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User who requested the change (requester)',
  },
  assignment_type: {
    type: DataTypes.ENUM('new', 'mod'),
    allowNull: false,
    defaultValue: 'new',
    comment: 'new=first time, mod=modification',
  },
  version: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'V1',
    comment: 'Dynamic version - V1, V2, V3, etc.',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Details about the issue/change requested',
  },
  // Fields from Tasks table - behaves like sub-count of task
  deadline: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Deadline for the issue assignment',
  },
  intimate_team: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Flag to intimate team (0=no, 1=yes)',
  },
  task_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Count of tasks for this issue assignment',
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Start date for the issue assignment',
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'End date for the issue assignment',
  },
  link: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Link URL for the issue assignment',
  },
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'rejected'),
    defaultValue: 'pending',
  },
  review: {
    type: DataTypes.ENUM('pending', 'approved', 'change_request'),
    defaultValue: 'pending',
    comment: 'Review status - pending, approved, or change_request',
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
  tableName: 'issue_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = IssueAssignments;
