const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const IssueAssignmentTypes = sequelize.define('IssueAssignmentTypes', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  issue_assignment_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Reference to issue_assignments table',
  },
  issue_register_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Reference to issue_register table (change_issue_type)',
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
  tableName: 'issue_assignment_types',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = IssueAssignmentTypes;
