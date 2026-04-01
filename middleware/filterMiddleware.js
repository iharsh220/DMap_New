const filterMiddleware = (req, res, next) => {
    const filters = {};

    // Extract filter parameters from query
    // Note: status, deadline, review, review_stages are also included in filters
    // because they need special handling in controllers but should still go through the filter logic
    Object.keys(req.query).forEach(key => {
        if (!['page', 'limit', 'search', 'searchFields', 'sort', 'order', 'user_id', 'user_name', 'assigned_to'].includes(key)) {
            let value = req.query[key];
            if (typeof value === 'string' && value.includes(',')) {
                value = value.split(',').map(s => s.trim());
            }
            filters[key] = value;
        }
    });

    req.filters = filters;
    next();
};

module.exports = filterMiddleware;