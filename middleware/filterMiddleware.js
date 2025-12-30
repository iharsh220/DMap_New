const filterMiddleware = (req, res, next) => {
    const filters = {};

    // Extract filter parameters from query
    Object.keys(req.query).forEach(key => {
        if (!['page', 'limit', 'search', 'searchFields', 'sort', 'order'].includes(key)) {
            filters[key] = req.query[key];
        }
    });

    req.filters = filters;
    next();
};

module.exports = filterMiddleware;