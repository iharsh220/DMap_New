const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Sales = sequelize.define('Sales', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  emp_code: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  emp_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  level: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  hq: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  region: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  zone: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  division_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  sap_code: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  mobile_number: {
    type: DataTypes.STRING(15),
    allowNull: true,
  },
  email_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  user_type: {
    type: DataTypes.ENUM('sales'),
    defaultValue: 'sales',
  },
  email_verified_status: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  password: {
    type: DataTypes.STRING(255),
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
  tableName: 'sales',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Sales;