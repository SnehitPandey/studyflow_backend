import { Router } from 'express';
import { roomController } from '../controllers/room.controller.js';
import { authenticateToken, optionalAuth } from '../middleware/auth.middleware.js';

const router = Router();

// Protected routes (require authentication)
router.post('/', authenticateToken, roomController.createRoom.bind(roomController));
router.post('/join', authenticateToken, roomController.joinRoom.bind(roomController));
router.post('/:roomId/leave', authenticateToken, roomController.leaveRoom.bind(roomController));
router.post('/:roomId/ready', authenticateToken, roomController.toggleReady.bind(roomController));

// Semi-protected routes (optional authentication for public rooms)
router.get('/:roomId', optionalAuth, roomController.getRoomById.bind(roomController));

export { router as roomRouter };
