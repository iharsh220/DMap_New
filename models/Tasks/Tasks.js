const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Tasks = sequelize.define('Tasks', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  quarter: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  project_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  assigned_by_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  division_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  work_type: {
    type: DataTypes.ENUM('Design', 'Video', 'Development', 'Marketing', 'Content', 'Photography', 'Branding', 'UI/UX', 'Backend', 'New Mod'),
    defaultValue: 'Design',
  },
  request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  task_type: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  artist_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  manager_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  no_of_work_pages: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_of_project: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_of_options: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_of_takes_photos: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_of_words: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  no_of_overdue: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  month: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  request_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  initiation_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  completion_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  project_status: {
    type: DataTypes.ENUM('upcoming', 'ongoing', 'completed'),
    defaultValue: 'upcoming',
  },
  leadership: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  concept: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  shoot_set_up: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  shoot_hours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
  },
  resize: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  last_moment_work: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  project_scale: {
    type: DataTypes.ENUM('small', 'medium', 'high'),
    allowNull: true,
  },
  project_priority: {
    type: DataTypes.ENUM('critical', 'high', 'publish date'),
    allowNull: true,
  },
  highlighted: {
    type: DataTypes.TINYINT,
    defaultValue: 0,
  },
  appreciation: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  appreciated_by: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  appreciated_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  remark: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  brief_comments: {
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
  tableName: 'tasks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

module.exports = Tasks;