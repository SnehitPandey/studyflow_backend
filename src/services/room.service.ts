import { Types } from 'mongoose';
import { Room, IRoom, IRoomMember } from '../models/room.model.js';
import { User } from '../models/user.model.js';
import { createError } from '../middleware/errorHandler.js';
import { connectToRedis } from '../config/redis.js';

export interface CreateRoomData {
  title: string;
  maxSeats?: number;
}

export interface JoinRoomData {
  code: string;
}

export interface UpdateRoomData {
  title?: string;
  status?: 'WAITING' | 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  maxSeats?: number;
}

export class RoomService {
  private redis = connectToRedis();

  // Generate unique room code
  private generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // Create a new room
  async createRoom(hostId: string, data: CreateRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(hostId)) {
      throw createError('Invalid user ID', 400);
    }

    // Verify host exists
    const host = await User.findById(hostId);
    if (!host) {
      throw createError('User not found', 404);
    }

    // Generate unique code
    let code = this.generateRoomCode();
    let attempts = 0;
    
    while (attempts < 10) {
      const existing = await Room.findOne({ code });
      if (!existing) break;
      code = this.generateRoomCode();
      attempts++;
    }

    if (attempts === 10) {
      throw createError('Failed to generate unique room code', 500);
    }

    // Create room with host as first member
    const room = new Room({
      code,
      hostId: new Types.ObjectId(hostId),
      title: data.title,
      maxSeats: data.maxSeats || 8,
      members: [{
        userId: new Types.ObjectId(hostId),
        role: 'HOST',
        ready: false,
        joinedAt: new Date(),
      }],
    });

    await room.save();

    // Populate host information
    await room.populate('hostId', 'name email');
    await room.populate('members.userId', 'name email');

    // Initialize presence in Redis
    await this.redis.hset(`room:${room._id}:presence`, hostId, JSON.stringify({
      id: hostId,
      name: host.name,
      ready: false,
      isOnline: true,
    }));

    return room;
  }

  // Join room by code
  async joinRoom(userId: string, data: JoinRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    // Find room by code
    const room = await Room.findOne({ code: data.code })
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Validation checks
    if (room.status === 'COMPLETED') {
      throw createError('Room is completed', 400);
    }

    if (room.members.length >= room.maxSeats) {
      throw createError('Room is full', 400);
    }

    // Check if user is already a member
    const existingMember = room.members.find(member => 
      member.userId._id.toString() === userId
    );

    if (existingMember) {
      throw createError('Already a member of this room', 400);
    }

    // Get user info
    const user = await User.findById(userId);
    if (!user) {
      throw createError('User not found', 404);
    }

    // Add user to room
    room.members.push({
      userId: new Types.ObjectId(userId),
      role: 'MEMBER',
      ready: false,
      joinedAt: new Date(),
    } as IRoomMember);

    await room.save();

    // Update Redis presence
    await this.redis.hset(`room:${room._id}:presence`, userId, JSON.stringify({
      id: userId,
      name: user.name,
      ready: false,
      isOnline: true,
    }));

    // Re-populate after save
    await room.populate('members.userId', 'name email');

    return room;
  }

  // Get room by ID
  async getRoomById(roomId: string, userId: string): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId)
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Check if user is a member
    const isMember = room.members.some(member => 
      member.userId._id.toString() === userId
    );

    if (!isMember) {
      throw createError('Access denied - not a room member', 403);
    }

    return room;
  }

  // Update room
  async updateRoom(roomId: string, hostId: string, data: UpdateRoomData): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(hostId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findOneAndUpdate(
      { _id: roomId, hostId: new Types.ObjectId(hostId) },
      { $set: data },
      { new: true }
    )
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found or access denied', 404);
    }

    return room;
  }

  // Leave room
  async leaveRoom(roomId: string, userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId);
    if (!room) {
      throw createError('Room not found', 404);
    }

    // Remove member from room
    room.members = room.members.filter(member => 
      member.userId.toString() !== userId
    );

    // If host leaves and there are other members, transfer host to first member
    if (room.hostId.toString() === userId && room.members.length > 0) {
      room.hostId = room.members[0].userId;
      room.members[0].role = 'HOST';
    }

    // If no members left, mark room as completed
    if (room.members.length === 0) {
      room.status = 'COMPLETED';
    }

    await room.save();

    // Remove from Redis presence
    await this.redis.hdel(`room:${roomId}:presence`, userId);
  }

  // Update user ready status
  async toggleReady(roomId: string, userId: string): Promise<IRoom> {
    if (!Types.ObjectId.isValid(roomId) || !Types.ObjectId.isValid(userId)) {
      throw createError('Invalid ID format', 400);
    }

    const room = await Room.findById(roomId)
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email');

    if (!room) {
      throw createError('Room not found', 404);
    }

    // Find member and toggle ready status
    const member = room.members.find(m => m.userId._id.toString() === userId);
    if (!member) {
      throw createError('Not a member of this room', 403);
    }

    member.ready = !member.ready;
    await room.save();

    // Update Redis presence
    const user = await User.findById(userId);
    await this.redis.hset(`room:${roomId}:presence`, userId, JSON.stringify({
      id: userId,
      name: user?.name,
      ready: member.ready,
      isOnline: true,
    }));

    return room;
  }

  // Get room presence from Redis
  async getRoomPresence(roomId: string): Promise<any[]> {
    const presence = await this.redis.hgetall(`room:${roomId}:presence`);
    return Object.values(presence).map(data => JSON.parse(data));
  }

  // Update user online status
  async updateUserOnlineStatus(roomId: string, userId: string, isOnline: boolean): Promise<void> {
    const presenceData = await this.redis.hget(`room:${roomId}:presence`, userId);
    if (presenceData) {
      const parsed = JSON.parse(presenceData);
      parsed.isOnline = isOnline;
      await this.redis.hset(`room:${roomId}:presence`, userId, JSON.stringify(parsed));
    }
  }

  // Get user's rooms
  async getUserRooms(userId: string): Promise<IRoom[]> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    return await Room.find({
      $or: [
        { hostId: new Types.ObjectId(userId) },
        { 'members.userId': new Types.ObjectId(userId) }
      ]
    })
      .populate('hostId', 'name email')
      .populate('members.userId', 'name email')
      .sort({ updatedAt: -1 });
  }
}

// Export singleton instance
export const roomService = new RoomService();
