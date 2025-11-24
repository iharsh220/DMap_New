const CrudService = require('../../services/crudService');
const { User, Department, Division, JobRole, Location, Designation } = require('../../models');
const { generateAccessToken, verifyRefreshToken } = require('../../middleware/jwtMiddleware');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');

const userService = new CrudService(User);

// Refresh token
const refreshToken = async (req, res) => {
    try {
        const { refreshToken: token } = req.body;

        if (!token) {
            await logUserActivity({
                event: 'refresh_token_failed',
                reason: 'token_required',
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'Refresh token required' });
        }

        const decoded = await verifyRefreshToken(token);

        // Fetch full user data
        const userResult = await userService.getById(decoded.id, {
            include: [
                { model: Department },
                { model: Division },
                { model: JobRole },
                { model: Location },
                { model: Designation }
            ]
        });

        if (!userResult.success || !userResult.data) {
            await logUserActivity({
                event: 'refresh_token_failed',
                reason: 'user_not_found',
                userId: decoded.id,
                ...extractRequestDetails(req)
            });
            return res.status(401).json({ success: false, error: 'User not found' });
        }

        const user = userResult.data;

        // Prepare user data like in login
        const userData = user.toJSON();
        delete userData.password;

        // Remove foreign key IDs
        delete userData.department_id;
        delete userData.division_id;
        delete userData.job_role_id;
        delete userData.location_id;
        delete userData.designation_id;

        // Rename associations
        if (userData.Department) {
            userData.department = userData.Department;
            delete userData.department.created_at;
            delete userData.department.updated_at;
            delete userData.Department;
        }
        if (userData.Division) {
            userData.division = userData.Division;
            delete userData.division.created_at;
            delete userData.division.updated_at;
            delete userData.Division;
        }
        if (userData.JobRole) {
            userData.jobRole = userData.JobRole;
            delete userData.jobRole.created_at;
            delete userData.jobRole.updated_at;
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

        userData.userType = decoded.userType || 'user';

        const newAccessToken = await generateAccessToken(userData);

        await logUserActivity({
            event: 'refresh_token_success',
            userId: user.id,
            email: user.email,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, accessToken: newAccessToken, user: userData });
    } catch (error) {
        console.error('Error refreshing token:', error);
        await logUserActivity({
            event: 'refresh_token_failed',
            reason: 'invalid_token',
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
};

module.exports = refreshToken;