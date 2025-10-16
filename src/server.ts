import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp, logger } from './app.js';
import { env } from './config/env.js';
import { SocketService } from './services/socket.service.js';
import { AuthService } from './services/auth.service.js';

// --- SERVICE SINGLETONS ---
// Initialize and export services here to ensure a single instance is used
// throughout the application and to allow for dependency injection (like passing the logger).
export const authService = new AuthService();
logger.info('✅ AuthService initialized');


// Server startup function
async function startServer(): Promise<void> {
  try {
    logger.info('🚀 Starting StudyFlow Backend Server...');
    
    // Create Express app
    const app = await createApp();
    
    // Create HTTP server
    const httpServer = createServer(app);
    
    // Initialize Socket.IO server
    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: env.NODE_ENV === 'production'
          ? [
              'https://studyflow.app',
              'https://app.studyflow.com',
              'https://www.studyflow.app'
            ]
          : [
              'http://localhost:3000',
              'http://localhost:3001',
              'http://127.0.0.1:3000'
            ],
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true, // Allow Engine.IO v3 clients
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Initialize Socket.IO service
    new SocketService(io as any, logger);
    logger.info('✅ Socket.IO server initialized');

    // Start server
    const PORT = env.PORT || 5000;
    const HOST = env.HOST || '0.0.0.0';

    httpServer.listen(PORT, HOST, () => {
      logger.info({
        port: PORT,
        host: HOST,
        nodeEnv: env.NODE_ENV,
        nodeVersion: process.version,
        platform: process.platform,
        architecture: process.arch,
        memory: {
          rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        }
      }, `✅ StudyFlow Backend Server running on http://${HOST}:${PORT}`);
      
      logger.info('📚 Available endpoints:');
      logger.info('   📊 Health: /health');
      logger.info('   🔐 Auth: /api/auth/*');
      logger.info('   🏠 Rooms: /api/rooms/*');
      logger.info('   📋 Tasks: /api/boards, /api/lists, /api/tasks');
      logger.info('   🤖 AI: /api/ai/*');
      logger.info('   📚 Channels: /api/channels/*');
      logger.info('   🔔 Notifications: /api/notifications/*');
      logger.info('   ⚡ WebSocket: ws://localhost:' + PORT);
      
      if (env.NODE_ENV === 'development') {
        logger.info('🔧 Development mode - Additional features enabled');
        logger.info('   📁 File uploads: /uploads/*');
        logger.info('   🔍 API docs: /api');
      }
    });

    // Server error handling
    httpServer.on('error', (error: any) => {
      if (error.syscall !== 'listen') {
        throw error;
      }

      const bind = typeof PORT === 'string' ? `Pipe ${PORT}` : `Port ${PORT}`;

      switch (error.code) {
        case 'EACCES':
          logger.fatal(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.fatal(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          logger.fatal({ error }, 'Server error');
          throw error;
      }
    });

    // Graceful shutdown handler
    const gracefulShutdown = (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      httpServer.close((err) => {
        if (err) {
          logger.error({ error: err }, 'Error during server shutdown');
          return process.exit(1);
        }
        
        logger.info('HTTP server closed');
        
        // Close Socket.IO server
        io.close(() => {
          logger.info('Socket.IO server closed');
          
          // Close database connections
          import('./config/db.js').then(({ disconnectFromDatabase }) => {
            disconnectFromDatabase(logger).finally(() => {
              logger.info('Database connections closed');
              
              // Close Redis connection
              import('./config/redis.js').then(async ({ connectToRedis }) => {
                try {
                  const redis = connectToRedis();
                  await redis.quit();
                  logger.info('Redis connection closed');
                } catch (error) {
                  logger.warn({ error }, 'Redis disconnect warning');
                }
                
                logger.info('Graceful shutdown completed');
                process.exit(0);
              });
            });
          });
        });
      });
      
      // Force close after 30 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after 30 seconds');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, ' Uncaught Exception - Server will restart');
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error({
        reason,
        promise: promise.toString()
      }, 'Unhandled Promise Rejection');
      
      // In production, exit to let process manager restart
      if (env.NODE_ENV === 'production') {
        process.exit(1);
      }
    });

    // Memory monitoring in development
    if (env.NODE_ENV === 'development') {
      setInterval(() => {
        const memUsage = process.memoryUsage();
        logger.debug({
          memory: {
            rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
            heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
          }
        }, 'Memory usage');
      }, 60000); // Every minute
    }

  } catch (error) {
    logger.fatal({ error }, '💥 Failed to start server');
    process.exit(1);
  }
}

// Start the server
startServer().catch((error) => {
  logger.fatal({ error }, '💥 Server startup failed');
  process.exit(1);
});
