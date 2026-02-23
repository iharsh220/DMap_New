const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const TaskDocuments = sequelize.define('TaskDocuments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_assignment_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
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
    defaultValue: 'V1',
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
  tableName: 'task_documents',
  timestamps: false,
});

module.exports = TaskDocuments;