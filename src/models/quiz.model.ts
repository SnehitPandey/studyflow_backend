import { Schema, model, Document, Types } from 'mongoose';

export interface IQuizQuestion {
  q: string;
  options: string[];
  answerIndex: number;
  explanation?: string;
}

export interface IQuiz extends Document {
  _id: Types.ObjectId;
  topic: string;
  difficulty: string;
  questions: IQuizQuestion[];
  creatorId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const quizQuestionSchema = new Schema<IQuizQuestion>({
  q: {
    type: String,
    required: true,
  },
  options: {
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => v.length === 4,
      message: 'Quiz must have exactly 4 options',
    },
  },
  answerIndex: {
    type: Number,
    required: true,
    min: 0,
    max: 3,
  },
  explanation: String,
});

const quizSchema = new Schema<IQuiz>({
  topic: {
    type: String,
    required: true,
    trim: true,
  },
  difficulty: {
    type: String,
    default: 'Medium',
    enum: ['Easy', 'Medium', 'Hard'],
  },
  questions: [quizQuestionSchema],
  creatorId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Indexes
quizSchema.index({ topic: 1 });
quizSchema.index({ creatorId: 1 });
quizSchema.index({ difficulty: 1 });

export const Quiz = model<IQuiz>('Quiz', quizSchema);
