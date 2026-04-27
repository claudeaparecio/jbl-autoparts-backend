const Session = require("../../models/session.model");
const User = require("../../models/user.model");
const createToken = require("../../utils/createToken");
const ErrorCodes = require("../../utils/ErrorCodes");
const bcrypt = require("bcrypt");

const getUsers = async (req, res, next) => {
  const { role } = req.query;

  const filter = {
    _id: { $ne: req.user._id },
    ...(role && { role })
  };

  const users = await User.find(filter).select("-password");

  return res.json({
    status: "success",
    data: {
      users
    },
  });
}

const deactivateUser = async (req, res) => {
  try {
    const {
      userId
    } = req.params;
    await User.findByIdAndUpdate(userId, {
      active: false
    })

    res.status(200).json({
      message: "User deactivated.",
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
}

const activateUser = async (req, res) => {
  try {
    const {
      userId
    } = req.params;
    await User.findByIdAndUpdate(userId, {
      active: true
    })

    res.status(200).json({
      message: "User activated.",
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
}

const signUp = async (req, res) => {
  const {
    username,
    password,
    role,
    name,
    customRole,
  } = req.body;
  try {
    // @ts-ignore
    const user = await User.signup(username, password, role, name, customRole);
    const token = createToken(user);
    return res.json({
      status: "success",
      token,
      data: {
        username: user.username,
        id: user._id,
      },
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
};

const logIn = async (req, res) => {
  try {
    // @ts-ignore
    const user = await User.login(req.body.username, req.body.password);

    if (!user.active) {
      return res.status(403).json({
        message: "User is not active"
      });
    }

    const token = createToken(user);

    await Session.create({
      userId: user._id,
      token,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });

    return res.json({
      status: "success",
      token,
      data: {
        id: user._id,
        username: user.username,
        role: user.role,
        name: user.name || "",
        customRole: user.customRole,
      },
    });

  } catch (error) {
    return res.status(401).json({
      status: "failed",
      message: error.message,
    });
  }
};

const logout = async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(400).json({
    message: "No token provided"
  });

  await Session.updateOne({
    token
  }, {
    isActive: false
  });

  res.json({
    message: "Logged out successfully"
  });
};

const resetPassword = async (req, res, next) => {
  const {
    userId,
    newPassword
  } = req.body;

  if (!userId || !newPassword) {
    return res.status(400).json({
      message: "User ID and new password are required"
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      message: "User not found"
    });
  }

  const salt = await bcrypt.genSalt(10);
  user.password = await bcrypt.hash(newPassword, salt);
  // @ts-ignore
  user.changedPassword = Date.now();

  await user.save();

  res.json({
    message: "Password has been reset successfully"
  });
};

const changedPassword = async (req, res) => {
  try {
    const {
      userId
    } = req.params;

    // @ts-ignore
    await User.changePasswordById(userId, req.body.newPassword)

    res.status(200).json({
      message: "Password changed.",
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
}

const updateDetails = async (req, res) => {
  try {
    const {
      userId
    } = req.params;

    const {
      username,
      name,
    } = req.body;

    // @ts-ignore
    const user = await User.findByIdAndUpdate(userId, {
      username,
      name,
    },
      {
        new: true,
        runValidators: true
      }).lean();

    res.status(200).json({
      message: "Password changed.",
      data: user,
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
}

const getUserDetails = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");

    return res.status(200).json({
      message: "Success",
      data: user,
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
};

module.exports = {
  logIn,
  signUp,
  getUsers,
  resetPassword,
  logout,
  deactivateUser,
  activateUser,
  changedPassword,
  updateDetails,
  getUserDetails,
};