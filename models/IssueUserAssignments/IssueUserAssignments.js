const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const IssueUserAssignments = sequelize.define('IssueUserAssignments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  issue_assignment_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Linked to issue_assignments table',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User assigned to work on this issue',
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
  tableName: 'issue_user_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = IssueUserAssignments;
