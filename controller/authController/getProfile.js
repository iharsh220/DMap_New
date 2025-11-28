const CrudService = require('../../services/crudService');
const { User, Sales, Department, Division, JobRole, Location, Designation, UserDivisions } = require('../../models');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);

// Get User Profile
const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const userType = req.user.userType || 'user';

        let user = null;
        let service = null;

        if (userType === 'user') {
            service = userService;
        } else if (userType === 'sales') {
            service = salesService;
        } else {
            await logUserActivity({
                event: 'get_profile_failed',
                reason: 'invalid_user_type',
                userId,
                userType,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Invalid user type' });
        }

        // Get user with all related data
        const userResult = await service.getById(userId, {
            include: userType === 'user' ? [
                { model: Department },
                { model: Division, as: 'Divisions' },
                { model: JobRole },
                { model: Location },
                { model: Designation }
            ] : [
                { model: Division }
            ]
        });

        if (!userResult.success || !userResult.data) {
            await logUserActivity({
                event: 'get_profile_failed',
                reason: 'user_not_found',
                userId,
                ...extractRequestDetails(req)
            });
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        user = userResult.data;

        // Prepare user data
        const userData = user.toJSON();
        delete userData.password; // Remove sensitive data
        delete userData.reset_token; // If exists
        delete userData.reset_token_expires; // If exists
        delete userData.login_attempts;
        delete userData.lock_until;
        delete userData.password_changed_at;
        delete userData.password_expires_at;
        delete userData.created_at;
        delete userData.updated_at;

        // Rename associations for consistency
        if (userType === 'user') {
            if (userData.Department) {
                userData.department = userData.Department;
                delete userData.department.created_at;
                delete userData.department.updated_at;
                delete userData.Department;
            }
            if (userData.Divisions && userData.Divisions.length > 0) {
                userData.Divisions = userData.Divisions.map(division => {
                    const { created_at, updated_at, UserDivisions, ...divisionData } = division;
                    return divisionData;
                });
            }
            if (userData.JobRole) {
                userData.jobRole = userData.JobRole;
                delete userData.jobRole.created_at;
                delete userData.jobRole.updated_at;
                delete userData.jobRole.department_id;
                delete userData.JobRole;
            }
            if (userData.Location) {
                userData.location = userData.Location;
                delete userData.location.created_at;
                delete userData.location.updated_at;
                delete userData.Location;
            }
            if (userData.Designation) {
                userData.designation = userData.Designation;
                delete userData.designation.created_at;
                delete userData.designation.updated_at;
                delete userData.Designation;
            }

            // Remove foreign key IDs
            delete userData.department_id;
            delete userData.division_id;
            delete userData.job_role_id;
            delete userData.location_id;
            delete userData.designation_id;
        }

        // Add user type
        userData.userType = userType;

        // For sales users, get additional divisions if any
        if (userType === 'sales') {
            // Sales users might have multiple divisions, but currently only one
            // If needed, can add UserDivisions logic here
        }

        await logUserActivity({
            event: 'get_profile_success',
            userId,
            ...extractRequestDetails(req)
        });

        res.status(200).json({
            success: true,
            data: userData
        });
    } catch (error) {
        console.error('Error getting profile:', error);
        await logUserActivity({
            event: 'get_profile_failed',
            reason: 'server_error',
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Failed to get profile' });
    }
};

module.exports = getProfile;