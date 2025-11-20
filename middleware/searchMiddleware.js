const searchMiddleware = (req, res, next) => {
  const search = req.query.search || '';
  const searchFields = req.query.searchFields ? req.query.searchFields.split(',') : [];

  req.search = {
    term: search,
    fields: searchFields
  };

  next();
};

module.exports = searchMiddleware;