const jwt = require("jsonwebtoken");

function createToken(user) {
  return jwt.sign(
    { _id: user._id, role: user.role, username: user.username, name: user.name },
    process.env.SECRET_JWT,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}

module.exports = createToken;
