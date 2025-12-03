const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const WorkRequests = sequelize.define('WorkRequests', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  project_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  brand: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  project_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  about_project: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
    defaultValue: 'medium',
  },
  status: {
    type: DataTypes.ENUM('draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred'),
    defaultValue: 'pending',
  },
  requested_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  remarks: {
    type: DataTypes.TEXT,
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
  tableName: 'work_requests',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = WorkRequests;