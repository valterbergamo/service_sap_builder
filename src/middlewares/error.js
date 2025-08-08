module.exports = (err, _req, res, _next) => {
  // Log básico (em prod você pode melhorar com um logger)
  console.error(err);

  return res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
};
