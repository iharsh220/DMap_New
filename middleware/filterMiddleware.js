const filterMiddleware = (req, res, next) => {
    const filters = {};

    // Extract filter parameters from query
    Object.keys(req.query).forEach(key => {
        if (!['page', 'limit', 'search', 'searchFields', 'sort', 'order'].includes(key)) {
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