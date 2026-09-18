const { DataTypes } = require('sequelize');

const { sequelize } = require('../../config/databaseConfig');

const Activity = sequelize.define('Activity', {

    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },

    created_user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },

    division_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },

    visible_to: {
        type: DataTypes.ENUM(
            'MR',
            'AM',
            'RM',
            'ZM',
            'NSM',
            'HO',
            'ALL'
        ),
        allowNull: false,
    },

    activity_name: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },

    start_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },

    end_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
    },

    activity_link: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },

    data_link: {
        type: DataTypes.STRING(500),
        allowNull: true,
    },

    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },

    comment: {
        type: DataTypes.TEXT,
        allowNull: true,
    },

    activity_status: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 1,
        comment: '0 = Inactive, 1 = Active',
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

    tableName: 'activity',

    timestamps: true,

    createdAt: 'created_at',

    updatedAt: 'updated_at',

    charset: 'utf8mb4',

    collate: 'utf8mb4_unicode_ci',

});

module.exports = Activity;