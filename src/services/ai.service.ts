import { createError } from '../middleware/errorHandler.js';

export interface RoadmapInput {
  goal: string;
  skillLevel: 'Beginner' | 'Intermediate' | 'Advanced';
  durationWeeks: number;
}

export interface QuizInput {
  topic: string;
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  count?: number;
}

class AIService {
  async generateRoadmap(input: RoadmapInput): Promise<any> {
    throw createError('AI service not yet implemented', 501);
  }
  
  async generateQuiz(input: QuizInput): Promise<any> {
    throw createError('AI service not yet implemented', 501);
  }
}

export const aiService = new AIService();
