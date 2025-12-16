const CrudService = require('../../services/crudService');
const { User, Department, Division, JobRole, Location, Designation } = require('../../models');
const { generateAccessToken, verifyRefreshToken, blacklistToken } = require('../../middleware/jwtMiddleware');

const userService = new CrudService(User);

// Refresh token
const refreshToken = async (req, res) => {
    try {
        const { refreshToken: token } = req.body;

        if (!token) {
           
            return res.status(400).json({ success: false, error: 'Refresh token required' });
        }

        const decoded = await verifyRefreshToken(token);

        // Fetch full user data
        const userResult = await userService.getById(decoded.id, {
            include: [
                { model: Department },
                { model: Division, as: 'Divisions' },
                { model: JobRole },
                { model: Location },
                { model: Designation }
            ]
        });

        if (!userResult.success || !userResult.data) {
            
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
        if (userData.Divisions && userData.Divisions.length > 0) {
            userData.divisions = userData.Divisions.map(div => {
                const { created_at, updated_at, ...divData } = div;
                return divData;
            });
            delete userData.Divisions;
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

        // Blacklist the old refresh token (7 days TTL)
        const refreshTtl = require('ms')(process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') / 1000;
        await blacklistToken(token, refreshTtl);

       
        res.json({ success: true, accessToken: newAccessToken, user: userData });
    } catch (error) {
        console.error('Error refreshing token:', error);
        
        res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }
};

module.exports = refreshToken;