const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const IssueAssignments = sequelize.define('IssueAssignments', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  issue_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Self-referenced to parent issue_assignments (for issue-related changes)',
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Linked to tasks table (for task-related changes)',
  },
  requested_by_user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User who requested the change (requester)',
  },
  assignment_type: {
    type: DataTypes.ENUM('new', 'mod'),
    allowNull: false,
    defaultValue: 'mod',
    comment: 'new=first time, mod=modification',
  },
  version: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'V1',
    comment: 'Dynamic version - V1, V2, V3, etc.',
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Details about the issue/change requested',
  },
  // Fields from Tasks table - behaves like sub-count of task
  deadline: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Deadline for the issue assignment',
  },
  intimate_team: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: 'Flag to intimate team (0=no, 1=yes)',
  },
  intimate_client: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    comment: '0=not shared with client, 1=shared with client for review',
  },
  shared_with_client_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Date when issue was shared with client for review',
  },
  task_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Count of tasks for this issue assignment',
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Start date for the issue assignment',
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'End date for the issue assignment',
  },
  link: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Link URL for the issue assignment',
  },
  status: {
    type: DataTypes.ENUM('m_pending', 'u_pending', 'm_accepted', 'u_accepted', 'in_progress', 'completed', 'rejected', 'on_hold', 'cancelled'),
    defaultValue: 'm_pending',
  },
  review: {
    type: DataTypes.ENUM('pending', 'approved', 'change_request'),
    defaultValue: 'pending',
    comment: 'Review status - pending, approved, or change_request',
  },
  review_stage: {
    type: DataTypes.ENUM('not_started', 'manager_review', 'pm_review', 'change_requested', 'final_approved'),
    defaultValue: 'not_started',
    comment: 'Review stage - not_started, manager_review, pm_review, change_requested, final_approved',
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
  no_of_resize_job: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0,
    comment: 'Number of resize jobs',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  comments: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional comments when submitting/completing an issue',
  },
}, {
  tableName: 'issue_assignments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = IssueAssignments;
