const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const DesignationJobRole = sequelize.define('DesignationJobRole', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    designation_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'designation',
            key: 'id',
        },
    },
    jobrole_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'job_role',
            key: 'id',
        },
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
    tableName: 'designation_jobroles',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

module.exports = DesignationJobRole;