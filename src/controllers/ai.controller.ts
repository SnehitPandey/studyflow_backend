import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { aiService, type RoadmapInput, type QuizInput } from '../services/ai.service.js';
import { createError } from '../middleware/errorHandler.js';

// Input validation schemas
const roadmapInputSchema = z.object({
  goal: z.string().min(5, 'Goal must be at least 5 characters').max(200, 'Goal too long'),
  skillLevel: z.enum(['Beginner', 'Intermediate', 'Advanced'], {
    errorMap: () => ({ message: 'Skill level must be Beginner, Intermediate, or Advanced' }),
  }),
  durationWeeks: z.number().int().min(1, 'Duration must be at least 1 week').max(52, 'Duration cannot exceed 52 weeks'),
});

const quizInputSchema = z.object({
  topic: z.string().min(2, 'Topic must be at least 2 characters').max(100, 'Topic too long'),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
  count: z.number().int().min(1, 'Count must be at least 1').max(20, 'Count cannot exceed 20').optional(),
});

export class AIController {
  // Generate learning roadmap
  async generateRoadmap(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = roadmapInputSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const input: RoadmapInput = validationResult.data;

      // Generate roadmap using AI service
      const roadmap = await aiService.generateRoadmap(input);

      // Send response
      res.status(200).json({
        success: true,
        roadmap: {
          goal: roadmap.goal,
          skillLevel: roadmap.skillLevel,
          totalDuration: roadmap.totalDuration,
          weeks: roadmap.weeks,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate quiz questions
  async generateQuiz(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw createError('Authentication required', 401);
      }

      // Validate input
      const validationResult = quizInputSchema.safeParse(req.body);
      if (!validationResult.success) {
        const errorMessage = validationResult.error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw createError(`Validation error: ${errorMessage}`, 400);
      }

      const input: QuizInput = validationResult.data;

      // Generate quiz using AI service
      const quiz = await aiService.generateQuiz(input);

      // Send response
      res.status(200).json({
        success: true,
        quiz: {
          topic: quiz.topic,
          difficulty: quiz.difficulty,
          items: quiz.items,
          totalQuestions: quiz.items.length,
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          userId: req.user.id,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export singleton instance
export const aiController = new AIController();
