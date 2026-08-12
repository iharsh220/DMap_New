const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const Feedbacks = sequelize.define('Feedbacks', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  task_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Linked task ID',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'User who submitted the feedback',
  },
  rating_functionality: {
    type: DataTypes.TINYINT,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Rating for functionality and ease of use (1-5)',
  },
  rating_timeliness: {
    type: DataTypes.TINYINT,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Rating for timeliness of delivery (1-5)',
  },
  rating_communication: {
    type: DataTypes.TINYINT,
    allowNull: false,
    validate: {
      min: 1,
      max: 5
    },
    comment: 'Rating for communication and responsiveness (1-5)',
  },
  recommendation_score: {
    type: DataTypes.TINYINT,
    allowNull: false,
    validate: {
      min: 0,
      max: 10
    },
    comment: 'Likelihood to recommend (0-10)',
  },
  comments: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional feedback comments',
  },
  is_deleted: {
    type: DataTypes.TINYINT(1),
    defaultValue: 0,
    allowNull: false,
    comment: 'Soft delete flag - 0=active, 1=deleted',
  },
}, {
  tableName: 'feedbacks',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
});

module.exports = Feedbacks;
