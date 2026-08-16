import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * User — application operators/administrators.
 *
 * Passwords are stored only as bcrypt hashes. The hash field is excluded from
 * query results by default (`select: false`) so it never leaks through the API.
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['admin', 'operator', 'viewer'],
      default: 'admin',
    },
  },
  { timestamps: true }
);

/** Hash and store a plaintext password. Never assign passwordHash directly. */
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  const saltRounds = 12;
  this.passwordHash = await bcrypt.hash(plainPassword, saltRounds);
};

/** Compare a plaintext candidate against the stored hash. */
userSchema.methods.verifyPassword = function verifyPassword(plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

/** Safe, client-facing representation — never includes the password hash. */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.model('User', userSchema);
