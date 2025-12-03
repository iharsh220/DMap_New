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
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  document_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('uploading', 'uploaded', 'failed'),
    defaultValue: 'uploading',
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