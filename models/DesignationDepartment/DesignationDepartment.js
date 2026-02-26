const { DataTypes } = require('sequelize');
const { sequelize } = require('../../config/databaseConfig');

const DesignationDepartment = sequelize.define('DesignationDepartment', {
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
    department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: 'department',
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
    tableName: 'designation_departments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
});

module.exports = DesignationDepartment;