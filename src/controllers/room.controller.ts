import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { roomService } from '../services/room.service.js';
import { createError } from '../middleware/errorHandler.js';

// Validation schemas
const createRoomSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100),
  maxSeats: z.number().int().min(2).max(20).optional(),
});

const joinRoomSchema = z.object({
  code: z.string().length(6, 'Room code must be 6 characters'),
});

export class RoomController {
  // Create new room
  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate request body
      const validatedData = createRoomSchema.parse(req.body);

      // Create room
      const room = await roomService.createRoom(req.user.id, validatedData);

      // Send response
      res.status(201).json({
        success: true,
        room: {
          id: room.id,
          code: room.code,
          title: room.title,
          hostId: room.hostId,
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          createdAt: room.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`, 
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  // Join room by code
  async joinRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate request body
      const validatedData = joinRoomSchema.parse(req.body);

      // Join room
      const room = await roomService.joinRoom(req.user.id, validatedData);

      // Send response
      res.status(200).json({
        success: true,
        room: {
          id: room.id,
          code: room.code,
          title: room.title,
          hostId: room.hostId,
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          members: room.members.map((member: any) => ({
            id: member.userId?.toString() || '',
            name: member.user?.name || 'Unknown',
            role: member.role,
            ready: member.ready,
            joinedAt: member.joinedAt,
          })),
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationError = createError(
          `Validation error: ${error.errors.map(e => e.message).join(', ')}`, 
          400
        );
        return next(validationError);
      }
      next(error);
    }
  }

  // Leave room
  async leaveRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      await roomService.leaveRoom(req.user.id, roomId);

      res.status(200).json({
        success: true,
        message: 'Left room successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  // Get room details
  async getRoomById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }
      const userId = req.user?.id || '';

      const room = await roomService.getRoomById(roomId, userId);

      res.status(200).json({
        success: true,
        room: {
          id: room.id,
          code: room.code,
          title: room.title,
          hostId: room.hostId,
          status: room.status,
          maxSeats: room.maxSeats,
          memberCount: room.members.length,
          members: room.members.map((member: any) => ({
            id: member.userId?.toString() || '',
            name: member.user?.name || 'Unknown',
            role: member.role,
            ready: member.ready,
            joinedAt: member.joinedAt,
          })),
          createdAt: room.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Toggle ready state
  async toggleReady(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      const { roomId } = req.params;
      if (!roomId) {
        throw createError('Room ID is required', 400);
      }

      const ready = await roomService.toggleReady(req.user.id, roomId);

      res.status(200).json({
        success: true,
        ready,
        message: ready ? 'User is ready' : 'User is not ready',
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const roomController = new RoomController();
