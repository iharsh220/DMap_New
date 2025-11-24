const bcrypt = require('bcryptjs');
const { User, DesignationJobRole, UserDivisions } = require('../../models');
const { logUserActivity, extractRequestDetails } = require('../../services/elasticsearchService');
const { sendMail } = require('../../services/mailService');
const { renderTemplate } = require('../../services/templateService');

// Complete registration
const completeRegistration = async (req, res) => {
    try {
        const { email, name, password, phone, department_id, division_ids, designation_id, location_id } = req.body;

        // Validate division_ids
        if (!division_ids || !Array.isArray(division_ids) || division_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one division is required' });
        }

        // Get job role based on designation
        const designationJobRole = await DesignationJobRole.findOne({ where: { designation_id } });

        // Find user
        const user = await User.findOne({ where: { email } });
        if (!user || user.email_verified_status !== 1) {
            await logUserActivity({
                event: 'complete_registration_failed',
                reason: 'user_not_verified',
                email,
                ...extractRequestDetails(req)
            });
            return res.status(400).json({ success: false, error: 'User not found or email not verified' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user_divisions entries
        let firstUserDivisionId = null;
        if (division_ids && Array.isArray(division_ids)) {
            for (const divisionId of division_ids) {
                const userDivision = await UserDivisions.create({
                    user_id: user.id,
                    division_id: divisionId
                });
                if (!firstUserDivisionId) {
                    firstUserDivisionId = userDivision.id;
                }
            }
        }

        // Update user
        const now = new Date();
        const passwordExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days from now
        await User.update({
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
        }, { where: { email } });

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

        await logUserActivity({
            event: 'complete_registration_success',
            email,
            userId: user.id,
            ...extractRequestDetails(req)
        });
        res.json({ success: true, message: 'Registration completed successfully' });
    } catch (error) {
        console.error('Error completing registration:', error);
        await logUserActivity({
            event: 'complete_registration_failed',
            reason: 'server_error',
            email: req.body?.email || null,
            error: error.message,
            ...extractRequestDetails(req)
        });
        res.status(500).json({ success: false, error: 'Registration completion failed' });
    }
};

module.exports = completeRegistration;