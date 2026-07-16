import './env.js';
import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthedRequest, AuthUser } from './types.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';

export function signToken(user: AuthUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '90d' });
}

export function authRequired(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({ message: '未登录或登录已过期' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthUser;
    return next();
  } catch {
    return res.status(401).json({ message: '未登录或登录已过期' });
  }
}

