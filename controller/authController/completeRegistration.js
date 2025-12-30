const bcrypt = require('bcryptjs');
const CrudService = require('../../services/crudService');
const { User, DesignationJobRole, UserDivisions } = require('../../models');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');

const userService = new CrudService(User);
const userDivisionsService = new CrudService(UserDivisions);
const designationJobRoleService = new CrudService(DesignationJobRole);

// Complete registration
const completeRegistration = async (req, res) => {
    try {
        const { email, name, password, phone, department_id, division_ids, designation_id, location_id } = req.body;

        // Validate division_ids
        if (!division_ids || !Array.isArray(division_ids) || division_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one division is required' });
        }

        // Get job role based on designation
        const designationJobRoleResult = await designationJobRoleService.getAll({ where: { designation_id }, limit: 1 });
        const designationJobRole = designationJobRoleResult.success && designationJobRoleResult.data.length > 0 ? designationJobRoleResult.data[0] : null;

        // Find user
        const userResult = await userService.getAll({ where: { email }, limit: 1 });
        let user = null;
        if (userResult.success && userResult.data.length > 0) {
            user = userResult.data[0];
        }
        if (!user || user.email_verified_status !== 1) {
            return res.status(400).json({ success: false, error: 'User not found or email not verified' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user_divisions entries
        let firstUserDivisionId = null;
        if (division_ids && Array.isArray(division_ids)) {
            for (const divisionId of division_ids) {
                const userDivisionResult = await userDivisionsService.create({
                    user_id: user.id,
                    division_id: divisionId
                });
                if (userDivisionResult.success && !firstUserDivisionId) {
                    firstUserDivisionId = userDivisionResult.data.id;
                }
            }
        }

        // Update user
        const now = new Date();
        const passwordExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days from now
        await userService.updateById(user.id, {
            name,
            password: hashedPassword,
            phone,
            department_id,
            designation_id,
            job_role_id: designationJobRole ? designationJobRole.jobrole_id : null,
            location_id,
            account_status: 'active',
            password_changed_at: now,
            password_expires_at: passwordExpiresAt
        });

        // Send registration success email
        try {
            const html = renderTemplate('registrationSuccess', {
                name,
                email
            });
            await sendMail({
                to: email,
                subject: 'Registration Successful - D-Map',
                html
            });
        } catch (emailError) {
            console.error('Error sending registration success email:', emailError);
            // Don't fail registration if email fails
        }

        res.json({ success: true, message: 'Registration completed successfully' });
    } catch (error) {
        console.error('Error completing registration:', error);
        res.status(500).json({ success: false, error: 'Registration completion failed' });
    }
};

module.exports = completeRegistration;