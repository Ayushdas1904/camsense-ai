import mongoose from 'mongoose';

/**
 * Notification — user-facing message shown in the app's notification center.
 * Distinct from Alert: an Alert is a security event; a Notification is any
 * item surfaced to the operator. Future-ready schema.
 */
const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    severity: {
      type: String,
      enum: ['info', 'warning', 'critical'],
      default: 'info',
    },
    read: { type: Boolean, default: false, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const Notification = mongoose.model('Notification', notificationSchema);
