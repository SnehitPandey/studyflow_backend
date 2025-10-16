import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { User, IUser } from '../models/user.model.js';
import { Session, ISession } from '../models/session.model.js';
import { env } from '../config/env.js';
import { createError } from '../middleware/errorHandler.js';

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

export class AuthService {
  private readonly SALT_ROUNDS = 12;

  // Hash password with bcrypt
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  // Verify password
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  // Hash refresh token for storage
  private async hashRefreshToken(token: string): Promise<string> {
    return bcrypt.hash(token, 10);
  }

  // Generate JWT tokens
  private generateTokens(payload: TokenPayload): AuthTokens {
    const accessToken = (jwt.sign as any)(
      payload, 
      env.JWT_SECRET, 
      {
        expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN,
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }
    );

    const refreshToken = (jwt.sign as any)(
      { userId: payload.userId },
      env.JWT_REFRESH_SECRET,
      {
        expiresIn: env.JWT_REFRESH_TOKEN_EXPIRES_IN,
      }
    );

    return { accessToken, refreshToken };
  }

  // Register new user
  async register(data: RegisterData): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Check if user already exists
    const existingUser = await User.findOne({ email: data.email.toLowerCase() });
    if (existingUser) {
      throw createError('User with this email already exists', 409);
    }

    // Hash password
    const passwordHash = await this.hashPassword(data.password);

    // Create user
    const user = new User({
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      role: data.role || 'MEMBER',
    });

    await user.save();

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const tokens = this.generateTokens(tokenPayload);

    // Store refresh token session
    const refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const session = new Session({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
    });

    await session.save();

    return { user, tokens };
  }

  // Login user
  async login(data: LoginData): Promise<{ user: IUser; tokens: AuthTokens }> {
    // Find user by email
    const user = await User.findOne({ email: data.email.toLowerCase() });
    if (!user) {
      throw createError('Invalid credentials', 401);
    }

    // Verify password
    const isPasswordValid = await this.verifyPassword(data.password, user.passwordHash);
    if (!isPasswordValid) {
      throw createError('Invalid credentials', 401);
    }

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const tokens = this.generateTokens(tokenPayload);

    // Store refresh token session
    const refreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const session = new Session({
      userId: user._id,
      refreshTokenHash,
      expiresAt,
    });

    await session.save();

    return { user, tokens };
  }

  // Verify access token
  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET, {
        issuer: 'studyflow',
        audience: 'studyflow-app',
      }) as TokenPayload;
    } catch (error) {
      throw createError('Invalid access token', 401);
    }
  }

  // Refresh tokens
  async refreshTokens(refreshToken: string): Promise<{ user: IUser; tokens: AuthTokens }> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };

      // Find and verify session
      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });
      
      let validSession: ISession | null = null;
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isValid) {
          validSession = session;
          break;
        }
      }

      if (!validSession) {
        throw createError('Invalid refresh token', 401);
      }

      // Get user
      const user = await User.findById(payload.userId);
      if (!user) {
        throw createError('User not found', 404);
      }

      // Generate new tokens
      const tokenPayload: TokenPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
      };

      const tokens = this.generateTokens(tokenPayload);

      // Update session with new refresh token
      const newRefreshTokenHash = await this.hashRefreshToken(tokens.refreshToken);
      const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      validSession.refreshTokenHash = newRefreshTokenHash;
      validSession.expiresAt = newExpiresAt;
      await validSession.save();

      return { user, tokens };
    } catch (error) {
      throw createError('Invalid refresh token', 401);
    }
  }

  // Logout user
  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as { userId: string };

      // Find and delete session
      const sessions = await Session.find({ userId: new Types.ObjectId(payload.userId) });
      
      for (const session of sessions) {
        const isValid = await bcrypt.compare(refreshToken, session.refreshTokenHash);
        if (isValid) {
          await Session.findByIdAndDelete(session._id);
          break;
        }
      }
    } catch (error) {
      // Fail silently for logout
    }
  }

  // Get user by ID
  async getUserById(userId: string): Promise<IUser> {
    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400);
    }

    const user = await User.findById(userId);
    if (!user) {
      throw createError('User not found', 404);
    }

    return user;
  }
}

// Export singleton instance
export const authService = new AuthService();
