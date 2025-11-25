const CrudService = require('../../services/crudService');
const { WorkRequests, WorkMedium, User, WorkRequestDocuments } = require('../../models');

const workRequestService = new CrudService(WorkRequests);

const getAssignedWorkRequests = async (req, res) => {
    try {
        const manager_id = req.user.id;
        const { Op } = require('sequelize');

        let where = { requested_manager_id: manager_id };

        // Apply filters
        if (req.filters) {
            where = { ...where, ...req.filters };
        }

        // Apply search
        if (req.search.term && req.search.fields.length > 0) {
            where[Op.or] = req.search.fields.map(field => ({
                [field]: { [Op.like]: `%${req.search.term}%` }
            }));
        }

        const result = await workRequestService.getAll({
            where,
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
            ],
            limit: req.pagination.limit,
            offset: req.pagination.offset,
            order: [['created_at', 'DESC']]
        });

        if (result.success) {
            res.json({ success: true, data: result.data, pagination: req.pagination });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        console.error('Error fetching assigned work requests:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAssignedWorkRequestById = async (req, res) => {
    try {
        const { id } = req.params;
        const manager_id = req.user.id;

        const result = await workRequestService.getAll({
            where: { id, requested_manager_id: manager_id },
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } }
            ],
            limit: 1
        });

        if (result.success && result.data.length > 0) {
            res.json({ success: true, data: result.data[0] });
        } else {
            res.status(404).json({ success: false, error: 'Assigned work request not found' });
        }
    } catch (error) {
        console.error('Error fetching assigned work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getAssignedWorkRequests, getAssignedWorkRequestById };