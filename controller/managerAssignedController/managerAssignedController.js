const { WorkRequests, WorkMedium, User, WorkRequestDocuments } = require('../../models');

const getAssignedWorkRequests = async (req, res) => {
    try {
        const manager_id = req.user.id;

        const requests = await WorkRequests.findAll({
            where: { requested_manager_id: manager_id },
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'created_at', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
            ],
            order: [['created_at', 'DESC']]
        });

        res.json({ success: true, data: requests });
    } catch (error) {
        console.error('Error fetching assigned work requests:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAssignedWorkRequestById = async (req, res) => {
    try {
        const { id } = req.params;
        const manager_id = req.user.id;

        const request = await WorkRequests.findOne({
            where: { id, requested_manager_id: manager_id },
            attributes: { exclude: ['work_medium_id', 'requested_manager_id', 'created_at', 'updated_at'] },
            include: [
                { model: User, as: 'users', foreignKey: 'user_id', attributes: { exclude: ['password', 'created_at', 'updated_at', 'department_id', 'job_role_id', 'location_id', 'designation_id', 'last_login', 'login_attempts', 'lock_until', 'password_changed_at', 'password_expires_at'] } },
                { model: WorkMedium, attributes: { exclude: ['division_id', 'created_at', 'updated_at'] }, include: [{ model: require('../../models').Division, as: 'Division', attributes: { exclude: ['created_at', 'updated_at', 'department_id'] } }] },
                { model: WorkRequestDocuments, attributes: { exclude: ['created_at', 'updated_at'] } }
            ]
        });

        if (!request) {
            return res.status(404).json({ success: false, error: 'Assigned work request not found' });
        }

        res.json({ success: true, data: request });
    } catch (error) {
        console.error('Error fetching assigned work request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { getAssignedWorkRequests, getAssignedWorkRequestById };