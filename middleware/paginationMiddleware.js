const paginationMiddleware = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 25;
  const offset = limit === -1 ? 0 : (page - 1) * limit;

  req.pagination = {
    page,
    limit,
    offset
  };

  next();
};

module.exports = paginationMiddleware;