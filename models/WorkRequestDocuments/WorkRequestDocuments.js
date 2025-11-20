const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const WorkRequestDocuments = sequelize.define('WorkRequestDocuments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  work_request_id: {
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
  uploaded_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'work_request_documents',
  timestamps: false,
});

module.exports = WorkRequestDocuments;