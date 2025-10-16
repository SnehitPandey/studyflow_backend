import { Schema, model, Document, Types } from 'mongoose';

export interface IRoomMember {
  userId: Types.ObjectId;
  role: 'HOST' | 'CO_HOST' | 'MEMBER';
  ready: boolean;
  joinedAt: Date;
}

export interface IRoom extends Document {
  _id: Types.ObjectId;
  code: string;
  hostId: Types.ObjectId;
  title: string;
  status: 'WAITING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  maxSeats: number;
  members: IRoomMember[];
  createdAt: Date;
  updatedAt: Date;
}

const roomMemberSchema = new Schema<IRoomMember>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  role: {
    type: String,
    enum: ['HOST', 'CO_HOST', 'MEMBER'],
    default: 'MEMBER',
  },
  ready: {
    type: Boolean,
    default: false,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
});

const roomSchema = new Schema<IRoom>({
  code: {
    type: String,
    required: true,
    unique: true,
    length: 6,
  },
  hostId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
  },
  status: {
    type: String,
    enum: ['WAITING', 'ACTIVE', 'PAUSED', 'COMPLETED'],
    default: 'WAITING',
  },
  maxSeats: {
    type: Number,
    default: 8,
    min: 2,
    max: 20,
  },
  members: [roomMemberSchema],
}, {
  timestamps: true,
});

// Indexes
roomSchema.index({ code: 1 });
roomSchema.index({ hostId: 1 });
roomSchema.index({ status: 1 });
roomSchema.index({ 'members.userId': 1 });

export const Room = model<IRoom>('Room', roomSchema);
