const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const IssueDocuments = sequelize.define('IssueDocuments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  issue_user_assignment_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Linked to issue_user_assignments table',
  },
  document_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  document_path: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  document_type: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  document_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  version: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'V1',
    comment: 'Document version - V1, V2, V3, etc.',
  },
  status: {
    type: DataTypes.ENUM('uploading', 'uploaded', 'failed'),
    defaultValue: 'uploading',
  },
  review: {
    type: DataTypes.ENUM('pending', 'approved', 'change_request'),
    defaultValue: 'pending',
    comment: 'Document review status - pending, approved, or change_request',
  },
  uploaded_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'issue_documents',
  timestamps: false,
});

module.exports = IssueDocuments;
