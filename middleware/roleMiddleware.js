const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.jobRole.id)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        next();
    };
};

module.exports = { checkRole };