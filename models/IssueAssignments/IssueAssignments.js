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
  issue_register_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Type of issue/change from issue_register table',
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
  status: {
    type: DataTypes.ENUM('pending', 'in_progress', 'completed', 'rejected'),
    defaultValue: 'pending',
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
});

module.exports = IssueAssignments;
