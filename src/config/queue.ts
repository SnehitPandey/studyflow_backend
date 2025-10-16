import { connectToRedis } from './redis.js';
import type { Logger } from 'pino';
import { Queue, Job } from 'bullmq';

export interface ChatMessageJob {
  roomId: string;
  userId: string | null;
  username: string;
  content: string;
  type: 'TEXT' | 'SYSTEM' | 'EMOJI' | 'FILE';
  timestamp: string;
}

let chatQueue: Queue<ChatMessageJob> | null = null;

export const createChatQueue = (logger?: Logger): Queue<ChatMessageJob> => {
  if (!chatQueue) {
    const connection = connectToRedis(logger);
    
    chatQueue = new Queue<ChatMessageJob>('chat.persist', {
      connection,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    if (logger) {
      chatQueue.on('error', (error: Error) => {
        logger.error({ error }, 'Chat queue error');
      });

      chatQueue.on('waiting', (jobId: string) => {
        logger.debug({ jobId }, 'Chat job waiting');
      });

      // BullMQ .on('completed') signature is (job: Job, result: any)
      chatQueue.on('completed', (job: Job<ChatMessageJob>, result: any) => {
        logger.debug({ jobId: job.id }, 'Chat job completed');
      });

      // BullMQ .on('failed') signature is (job: Job | undefined, error: Error)
      chatQueue.on('failed', (job: Job<ChatMessageJob> | undefined, error: Error) => {
        logger.error(
          {
            jobId: job?.id,
            error,
          },
          'Chat job failed',
        );
      });
    }
  }

  return chatQueue;
};

export const getChatQueue = (): Queue<ChatMessageJob> => {
  if (!chatQueue) {
    throw new Error('Chat queue not initialized. Call createChatQueue() first.');
  }
  return chatQueue;
};

export const closeChatQueue = async (logger?: Logger): Promise<void> => {
  if (chatQueue) {
    await chatQueue.close();
    chatQueue = null;
    if (logger) {
      logger.info('Chat queue closed');
    }
  }
};
