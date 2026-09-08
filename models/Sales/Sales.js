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
  am_sapcode: {
    type: DataTypes.INTEGER,
    allowNull: false, 
  },
  rm_sapcode: {
    type: DataTypes.INTEGER,
    allowNull: false, 
  },
  zm_sapcode: {
    type: DataTypes.INTEGER,
    allowNull: false, 
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
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = Sales;

// ADDED Managers SAPCODE SQL QUERY ->
// ALTER TABLE `sales` ADD `am_sapcode` INT(11) NOT NULL AFTER `sap_code`, ADD `rm_sapcode` INT(11) NOT NULL AFTER `am_sapcode`, ADD `zm_sapcode` INT(11) NOT NULL AFTER `rm_sapcode`;


// Dummy Insert query
// INSERT INTO `sales` (`id`, `emp_code`, `emp_name`, `level`, `hq`, `region`, `zone`, `division_id`, `sap_code`, `am_sapcode`, `rm_sapcode`, `zm_sapcode`, `mobile_number`, `email_id`, `user_type`, `email_verified_status`, `password`, `account_status`, `last_login`, `login_attempts`, `lock_until`, `password_changed_at`, `password_expires_at`, `created_at`, `updated_at`) VALUES (NULL, '123456', 'Test User', 'MR', 'Mumbai 2', 'Mumbai', 'Mumbai', '16', '123456', '1234567', '12345678', '123456789', '123124124124', 'testuser@alembic.co.in', 'sales', '1', '123', 'pending', NULL, '0', NULL, NULL, NULL, current_timestamp(), current_timestamp());
