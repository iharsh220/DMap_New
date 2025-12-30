const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  phone: {
    type: DataTypes.STRING(15),
    allowNull: true,
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  department_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  job_role_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  location_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  designation_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  email_verified_status: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  latest_verification_token: {
    type: DataTypes.STRING(512),
    allowNull: true,
  },
  account_status: {
    type: DataTypes.ENUM('pending', 'active', 'inactive', 'locked', 'rejected', 'vacant'),
    defaultValue: 'pending',
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  login_attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  lock_until: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  password_changed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  password_expires_at: {
    type: DataTypes.DATE,
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
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = User;