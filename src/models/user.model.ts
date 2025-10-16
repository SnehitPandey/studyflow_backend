import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: 'ADMIN' | 'MODERATOR' | 'TEACHER' | 'MEMBER';
  skills?: string[];
  timezone?: string;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  role: {
    type: String,
    enum: ['ADMIN', 'MODERATOR', 'TEACHER', 'MEMBER'],
    default: 'MEMBER',
  },
  skills: [{
    type: String,
    trim: true,
  }],
  timezone: {
    type: String,
    default: 'UTC',
  },
}, {
  timestamps: true,
});

// Indexes
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });

export const User = model<IUser>('User', userSchema);
