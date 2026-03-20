const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Tasks = sequelize.define('Tasks', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  request_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  task_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  work_request_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  deadline: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('draft', 'pending', 'accepted', 'assigned', 'in_progress', 'completed', 'rejected', 'deferred'),
    defaultValue: 'pending',
  },
  version: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'V1',
    comment: 'Task version',
  },
  review: {
    type: DataTypes.ENUM('pending', 'approved', 'change_request'),
    defaultValue: 'pending',
    comment: 'Review status - pending, approved, or change_request',
  },
  review_stage: {
    type: DataTypes.ENUM('not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'),
    defaultValue: 'not_started',
    comment: 'Current review stage - not_started, manager_review, pm_review, change_requested, final_approved',
  },
  assignment_type: {
    type: DataTypes.ENUM('new', 'mod'),
    allowNull: false,
    defaultValue: 'new',
    comment: 'new=first time assignment, mod=modification request',
  },
  intimate_team: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
  },
  intimate_client: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '0=not shared with client, 1=shared with client for review',
  },
  shared_with_client_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Date when task was shared with client for review',
  },
  task_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
  },
  link: {
    type: DataTypes.STRING(500),
    allowNull: true,
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // Content Work fields
  no_of_options_provided: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of options provided for content work',
  },
  no_of_words_written: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of words written for content work',
  },
  options_submitted: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of options submitted',
  },
  concept_work: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Concept work done - 0=no, 1=yes',
  },
  resize_work: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Resize work done - 0=no, 1=yes',
  },
  no_of_concepts: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of concepts created',
  },
  // Duration fields (minutes and seconds)
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Duration in minutes',
  },
  duration_seconds: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Duration in seconds',
  },
  // Shoot/Product work fields
  product_shoot: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Product shoot done - 0=no, 1=yes',
  },
  no_of_products_shot: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of products shot',
  },
  shoot_setup: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Shoot setup done - 0=no, 1=yes',
  },
  // Video/Web work fields
  no_of_resize: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of resize operations',
  },
  // Responsive work fields
  responsive_screen: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Responsive screen work done - 0=no, 1=yes',
  },
  no_of_responsive_screen: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of responsive screens',
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
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = Tasks;