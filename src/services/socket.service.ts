import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { roomService } from './room.service.js';
import { authService } from './auth.service.js';
import { getChatQueue, type ChatMessageJob } from '../config/queue.js';
import type { Logger } from 'pino';

// FIX: Added a simple interface to type the chat message object
// This resolves the implicit 'any' error in the 'chatHistory' map function.
interface PopulatedMessage {
  id: string;
  user: { name: string };
  content: string;
  type: 'TEXT' | 'SYSTEM';
  createdAt: Date;
}

export interface SocketUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthenticatedSocket extends Socket {
  user: SocketUser;
}

export class SocketService {
  // FIX: Marked properties as 'readonly' as they are only set in the constructor.
  private readonly io: SocketIOServer;
  // FIX: Changed type to 'Logger | null' to work with 'exactOptionalPropertyTypes'.
  private readonly logger: Logger | null;

  constructor(httpServer: HttpServer, logger?: Logger) {
    // FIX: Assigned 'logger ?? null' to satisfy strict type checking.
    this.logger = logger ?? null;
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: env.SOCKET_IO_CORS_ORIGIN,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      },
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const payload = jwt.verify(token, env.JWT_SECRET) as any;
        const user = await authService.getUserById(payload.userId);

        if (!user) {
          return next(new Error('User not found'));
        }

        (socket as AuthenticatedSocket).user = {
          id: user.id,
          name: user.name,
          email: user.email,
        };

        next();
      } catch (error) {
        // FIX: Added logging to the catch block to handle the exception.
        this.logger?.error({ error }, 'Socket authentication failed');
        next(new Error('Invalid authentication token'));
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      const authenticatedSocket = socket as AuthenticatedSocket;
      const user = authenticatedSocket.user;

      this.logger?.info({
        userId: user.id,
        userName: user.name,
        socketId: socket.id,
      }, 'User connected to Socket.IO');

      socket.on('joinRoom', async (data: { roomId: string }) => {
        try {
          const { roomId } = data;

          // FIX: Removed 'const room =' as the variable was unused.
          // This call now acts purely as validation.
          await roomService.getRoomById(roomId, user.id);
          
          await socket.join(roomId);
          await roomService.updateUserOnlineStatus(roomId, user.id, true);
          const presence = await roomService.getRoomPresence(roomId);

          const systemMessage: ChatMessageJob = {
            roomId,
            userId: null,
            username: 'System',
            content: `${user.name} joined the room`,
            type: 'SYSTEM',
            timestamp: new Date().toISOString(),
          };

          socket.to(roomId).emit('systemMessage', {
            message: systemMessage.content,
            timestamp: systemMessage.timestamp,
          });

          const chatQueue = getChatQueue();
          await chatQueue.add('persistMessage', systemMessage);
          this.io.to(roomId).emit('roomUsers', presence);

          const recentMessages = await roomService.getRoomMessages(roomId, 20);
          socket.emit('chatHistory', recentMessages.reverse().map((msg: PopulatedMessage) => ({
            id: msg.id,
            username: msg.user.name,
            message: msg.content,
            type: msg.type,
            timestamp: msg.createdAt.toISOString(),
          })));

          this.logger?.info({
            userId: user.id,
            roomId,
            action: 'joinRoom',
          }, 'User joined room');

        } catch (error) {
          socket.emit('error', { 
            message: error instanceof Error ? error.message : 'Failed to join room' 
          });
        }
      });

      // ... (rest of your event handlers: leaveRoom, chatMessage, setReady, disconnect)
      // The logic inside them was already solid.
    });
  }

  async broadcastGroupUpdate(groups: Array<{groupId: number, members: Array<{userId: string, name: string, email: string}>}>) {
    try {
      this.io.emit('groupUpdate', {
        groups: groups.map(group => ({
          groupId: group.groupId,
          members: group.members.map(member => ({
            userId: member.userId,
            name: member.name,
          })),
          memberCount: group.members.length,
        })),
        timestamp: new Date().toISOString(),
      });

      this.logger?.info({
        totalGroups: groups.length,
        totalStudents: groups.reduce((sum, group) => sum + group.members.length, 0),
      }, 'Group update broadcasted via Socket.IO');

    } catch (error) {
      this.logger?.error({ error }, 'Failed to broadcast group update');
    }
  }

  getIO(): SocketIOServer {
    return this.io;
  }
}