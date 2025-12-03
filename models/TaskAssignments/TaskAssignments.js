const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const TaskAssignments = sequelize.define('TaskAssignments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  link: {
    type: DataTypes.STRING(500),
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
  tableName: 'task_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = TaskAssignments;