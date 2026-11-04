const paginationMiddleware = (req, res, next) => {
  // page < 1 or a negative limit other than -1 (= all rows) would give a negative OFFSET
  // and a SQL error, so they fall back to the defaults
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  let limit = parseInt(req.query.limit) || 25;
  if (limit < 1 && limit !== -1) limit = 25;
  const offset = limit === -1 ? 0 : (page - 1) * limit;

  req.pagination = {
    page,
    limit,
    offset
  };

  next();
};

module.exports = paginationMiddleware;