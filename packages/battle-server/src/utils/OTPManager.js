// packages/battle-server/src/utils/OTPManager.js

const crypto = require('crypto');

class OTPManager {
  constructor() {
    this.otpStore = new Map(); // otp -> { nickname, expiresAt }
    this.maxSpectators = 30;
  }

  generateOTP(nickname) {
    if (this.otpStore.size >= this.maxSpectators) return null;

    let otp;
    do {
      otp = crypto.randomBytes(3).toString('hex'); // 6자리 영숫자
    } while (this.otpStore.has(otp));

    const expiresAt = Date.now() + 30 * 60 * 1000; // 30분

    this.otpStore.set(otp, { nickname, expiresAt });
    return otp;
  }

  validateOTP(otp) {
    const data = this.otpStore.get(otp);
    if (!data) return false;
    if (Date.now() > data.expiresAt) {
      this.otpStore.delete(otp);
      return false;
    }
    return true;
  }

  getNickname(otp) {
    const data = this.otpStore.get(otp);
    return data ? data.nickname : null;
  }

  clearExpired() {
    const now = Date.now();
    for (const [otp, { expiresAt }] of this.otpStore.entries()) {
      if (now > expiresAt) this.otpStore.delete(otp);
    }
  }

  clearAll() {
    this.otpStore.clear();
  }
}

module.exports = OTPManager;
