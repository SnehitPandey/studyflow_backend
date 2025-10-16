import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { User, IUser } from '../models/user.model.js';
import { Session, ISession } from '../models/session.model.js';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';
import type { Logger } from 'pino';

// --- INTERFACES (no changes) ---
export interface RegisterData {
  email: string;
  password: string;
  name: string;
  role?: 'TEACHER' | 'MEMBER';
}

export interface LoginData {
  email: string;
  password: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

// --- REFACTORED AUTH SERVICE ---
export class AuthService {
  private readonly SALT_ROUNDS = 12;
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;
  private readonly logger: Logger | null;

  constructor(logger?: Logger) {
    this.logger = logger ?? null;
  }

  // --- PRIVATE HELPERS ---

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  private async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  private generateTokens(payload: TokenPayload): AuthTokens {
    try {
      const accessToken = jwt.sign(payload, env.JWT_SECRET, {
        expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN,
        issuer: 'studyflow',
        audience: 'studyflow-app',
      });

      const refreshToken = jwt.sign(
        { userId: payload.userId },
        env.JWT_REFRESH_SECRET,
        {
          expiresIn: env.JWT_REFRESH_TOKEN_EXPIRES_IN,
          issuer: 'studyflow',
          audience: 'studyflow-app',
        }
      );

      return { accessToken, refreshToken };
    } catch (error) {
      this.logger?.error({ error, userId: payload.userId }, 'Failed to generate JWT tokens');
      throw createError('Token generation failed', 500);
    }
  }

  /**
   * REFACTORED: Creates and stores a new refresh token session in the database.
   * This logic is now shared between login and register.
   */
  private async createSession(userId: Types.ObjectId, refreshToken: string): Promise<void> {
    const refreshTokenHash = await this.hashRefreshToken(refreshToken);
    const expiresAt = new Date(
      Date.now() + this.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    const session = new Session({
      userId,
      refreshTokenHash,
      expiresAt,
    });

    await session.save();
    this.logger?.info({ userId, sessionId: session._id }, 'User session created');
  }


  // --- PUBLIC API METHODS ---

  async register(data: RegisterData): Promise<{ user: IUser; tokens: AuthTokens }> {
    try {
      const existingUser = await User.findOne({ email: data.email.toLowerCase() });
      if (existingUser) {
        throw createError('User with this email already exists', 409);
      }

      const passwordHash = await this.hashPassword(data.password);

      const user = new User({
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        role: data.role || 'MEMBER',
      });
      await user.save();
      this.logger?.info({ userId: user._id, email: user.email }, 'User registered successfully');

      const tokenPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };
      const tokens = this.generateTokens(tokenPayload);

      // REFACTORED: Use the new helper method
      await this.createSession(user._id as Types.ObjectId, tokens.refreshToken);

      return { user, tokens };
    } catch (error) {
      this.logger?.error({ error, email: data.email }, 'Registration failed');
      throw error;
    }
  }

  async login(data: LoginData): Promise<{ user: IUser; tokens: AuthTokens }> {
    try {
      const user = await User.findOne({ email: data.email.toLowerCase() });
      if (!user) {
        throw createError('Invalid credentials', 401);
      }

      const isPasswordValid = await this.verifyPassword(data.password, user.passwordHash);
      if (!isPasswordValid) {
        this.logger?.warn({ email: data.email }, 'Failed login attempt - invalid password');
        throw createError('Invalid credentials', 401);
      }
      this.logger?.info({ userId: user._id, email: user.email }, 'User logged in successfully');

      const tokenPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };
      const tokens = this.generateTokens(tokenPayload);

      // REFACTORED: Use the new helper method
      await this.createSession(user._id as Types.ObjectId, tokens.refreshToken);

      return { user, tokens };
    } catch (error) {
      this.logger?.error({ error, email: data.email }, 'Login failed');
      throw error;
    }
  }

  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET, {
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }) as TokenPayload;
    } catch (error) {
      this.logger?.warn({ error }, 'Invalid access token provided');
      throw createError('Invalid access token', 401);
    }
  }

  async refreshTokens(refreshToken: string): Promise<{ user: IUser; tokens: AuthTokens }> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }) as { userId: string };

      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });

      let validSession: ISession | null = null;
      for (const session of sessions) {
        if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
          validSession = session;
          break;
        }
      }

      if (!validSession) {
        this.logger?.warn({ userId: payload.userId }, 'Invalid refresh token presented - no valid session found');
        throw createError('Invalid refresh token', 401);
      }

      const user = await User.findById(payload.userId);
      if (!user) {
        // This case is severe - a valid session exists for a non-existent user
        await Session.findByIdAndDelete(validSession._id); // Clean up orphan session
        this.logger?.error({ userId: payload.userId, sessionId: validSession._id }, 'Orphaned session found and deleted');
        throw createError('User not found', 404);
      }

      const tokenPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };
      const tokens = this.generateTokens(tokenPayload);

      // Refresh token rotation
      validSession.refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
      validSession.expiresAt = new Date(
        Date.now() + this.REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      );
      await validSession.save();
      
      this.logger?.info({ userId: user._id }, 'Tokens refreshed successfully');
      return { user, tokens };
    } catch (error) {
      this.logger?.error({ error }, 'Token refresh failed');
      throw createError('Invalid refresh token', 401);
    }
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, {
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }) as { userId: string };

      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });

      for (const session of sessions) {
        if (await bcrypt.compare(refreshToken, session.refreshTokenHash)) {
          await Session.findByIdAndDelete(session._id);
          this.logger?.info({ userId: payload.userId, sessionId: session._id }, 'User logged out successfully');
          break;
        }
      }
    } catch (error) {
      this.logger?.warn({ error }, 'Logout attempt with invalid token');
    }
  }

  async getUserById(userId: string): Promise<IUser | null> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID format', 400);
    }
    return User.findById(userId);
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await Session.deleteMany({ expiresAt: { $lt: new Date() } });
      if (result.deletedCount > 0) {
        this.logger?.info({ deletedCount: result.deletedCount }, 'Expired sessions cleaned up');
      }
      return result.deletedCount ?? 0;
    } catch (error) {
      this.logger?.error({ error }, 'Failed to cleanup expired sessions');
      return 0;
    }
  }
}

// REFACTORED: The singleton instance is no longer created here.
// It should be created in your main server/app file and passed the logger.
// This allows for proper dependency injection.
//
// For example, in server.ts:
//
// import { pino } from 'pino';
// import { AuthService } from './services/auth.service.js';
//
// const logger = pino();
// export const authService = new AuthService(logger);
