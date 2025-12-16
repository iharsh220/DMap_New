const bcrypt = require('bcryptjs');
const CrudService = require('../../services/crudService');
const { User, Sales, Department, Division, JobRole, Location, Designation, UserDivisions } = require('../../models');
const { generateAccessToken, generateRefreshToken } = require('../../middleware/jwtMiddleware');

const userService = new CrudService(User);
const salesService = new CrudService(Sales);

// Login
const login = async (req, res) => {
    try {
        const { identifier, password, loginType } = req.body;

        if (!password || !identifier || !loginType) {
            return res.status(400).json({ success: false, error: 'Identifier, password, and loginType are required' });
        }

        let user = null;
        let userType = '';

        if (loginType === 'email') {
            // Check User table first
            const userResult = await userService.getAll({
                where: { email: identifier },
                include: [
                    { model: Department },
                    { model: JobRole },
                    { model: Location },
                    { model: Designation }
                ],
                limit: 1
            });
            if (userResult.success && userResult.data.length > 0) {
                user = userResult.data[0];
            }
            if (!user) {
                // Check Sales table
                const salesResult = await salesService.getAll({
                    where: { email_id: identifier },
                    include: [
                        { model: Division }
                    ],
                    limit: 1
                });
                if (salesResult.success && salesResult.data.length > 0) {
                    user = salesResult.data[0];
                    userType = 'sales';
                }
            } else {
                userType = 'user';
            }
        } else if (loginType === 'sapcode') {
            const salesResult = await salesService.getAll({
                where: { sap_code: identifier },
                include: [
                    { model: Division }
                ],
                limit: 1
            });
            if (salesResult.success && salesResult.data.length > 0) {
                user = salesResult.data[0];
                userType = 'sales';
            }
        } else if (loginType === 'empcode') {
            const salesResult = await salesService.getAll({
                where: { emp_code: identifier },
                include: [
                    { model: Division }
                ],
                limit: 1
            });
            if (salesResult.success && salesResult.data.length > 0) {
                user = salesResult.data[0];
                userType = 'sales';
            }
        } else {
            return res.status(400).json({ success: false, error: 'Invalid login type' });
        }

        if (!user) {
            return res.status(401).json({ success: false, error: 'Email does not match our records' });
        }

        // Check email verified and account status
        if (user.email_verified_status !== 1) {
            return res.status(401).json({ success: false, error: 'Email not verified' });
        }

        if (user.account_status !== 'active') {
            if (user.account_status === 'locked') {
                // Check if lock has expired
                if (user.lock_until && user.lock_until > new Date()) {
                    const remainingTime = user.lock_until - new Date();
                    const minutes = Math.floor(remainingTime / (1000 * 60));
                    const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);
                    const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}min`;
                    return res.status(401).json({
                        success: false,
                        error: `Too many login attempts. Please try again in ${timeString}`
                    });
                } else {
                    // Unlock account
                    await userService.updateById(user.id, { account_status: 'active', lock_until: null });
                }
            } else {
                return res.status(401).json({ success: false, error: 'Account is not active' });
            }
        }

        // Check password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            // Increment login attempts
            const newAttempts = user.login_attempts + 1;
            if (newAttempts >= 5) {
                // Lock account for 30 minutes
                const lockUntil = new Date(Date.now() + 30 * 60 * 1000);
                await userService.updateById(user.id, { login_attempts: 0, account_status: 'locked', lock_until: lockUntil });
                return res.status(401).json({
                    success: false,
                    error: 'Too many login attempts. Please try again in 30:00min'
                });
            } else {
                const remainingAttempts = 5 - newAttempts;
                await userService.updateById(user.id, { login_attempts: newAttempts });
              
                return res.status(401).json({
                    success: false,
                    error: `Password does not match our records. ${remainingAttempts} attempts remaining`
                });
            }
        }

        // Successful login
        const now = new Date();
        await userService.updateById(user.id, { login_attempts: 0, last_login: now });

        // Generate tokens
        const userData = user.toJSON();
        delete userData.password;
        userData.userType = userType;

        // Fetch user divisions
        const divisions = await UserDivisions.findAll({ where: { user_id: user.id }, include: [{ model: Division, as: 'division' }] });
        userData.divisions = divisions.map(d => {
            const division = d.division.toJSON();
            delete division.created_at;
            delete division.updated_at;
            return division;
        });

        // Remove foreign key IDs since we have the full objects
        delete userData.department_id;
        delete userData.job_role_id;
        delete userData.location_id;
        delete userData.designation_id;

        // Rename associations to lowercase for consistency and remove timestamps
        if (userData.Department) {
            userData.department = userData.Department;
            delete userData.department.created_at;
            delete userData.department.updated_at;
            delete userData.Department;
        }
        if (userData.divisions && userData.divisions.length > 0) {
            // Keep userData.divisions for multiple divisions
            userData.divisions.forEach(div => {
                delete div.created_at;
                delete div.updated_at;
            });
        } else {
            userData.divisions = [];
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

        const tokenPayload = userData;
        const accessToken = await generateAccessToken(tokenPayload);
        const refreshToken = await generateRefreshToken(tokenPayload);

        // Check password expiry
        let passwordExpiryWarning = null;
        if (user.password_expires_at) {
            const timeDiff = user.password_expires_at - now;
            const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
            if (daysLeft <= 10) {
                passwordExpiryWarning = `Your password will expire in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Please change it.`;
            }
        }

        const response = {
            success: true,
            message: 'Login successful',
            accessToken,
            refreshToken,
            user: userData
        };

        if (passwordExpiryWarning) {
            response.passwordExpiryWarning = passwordExpiryWarning;
        }

        res.json(response);
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
};

module.exports = login;