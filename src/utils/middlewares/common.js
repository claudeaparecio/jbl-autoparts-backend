const jwt = require("jsonwebtoken");
const AppError = require("../AppError");
const Session = require("../../models/session.model");

const extractUser = async (req, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next(new AppError("Authorization header missing or malformed", 401));
  }

  const token = authHeader.split(" ")[1];

  try {
    // @ts-ignore
    const decoded = jwt.verify(token, process.env.SECRET_JWT);
    req.user = decoded;

    const session = await Session.findOne({ token, isActive: true }).select("_id").lean();
    if (!session) return null;

    return decoded;
  } catch (err) {
    return null;
  }
};

module.exports = extractUser;