// models/session.model.js
const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  ipAddress: String,
  userAgent: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: Date,
  isActive: {
    type: Boolean,
    default: true,
  },
});

sessionSchema.index({ token: 1, isActive: 1 });

module.exports = mongoose.model("sessions", sessionSchema);
