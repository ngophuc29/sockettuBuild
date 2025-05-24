const mongoose = require('mongoose');

const OTPSchema = new mongoose.Schema({
  email: { type: String, required: true },  
  otp: { type: String, required: true },
  expiration: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('OTP', OTPSchema);
