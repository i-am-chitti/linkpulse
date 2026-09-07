import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@linkpulse/shared';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { isProduction } from '../config/env.js';

/** Terminal 404 for unmatched routes, so they flow through the error envelope too. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  };
  res.status(404).json(body);
};

/** Flattens a ZodError into { "field.path": ["message"] }. */
function formatZodIssues(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '(root)';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Express has already started writing; nothing useful left to do.
  if (res.headersSent) return;

  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formatZodIssues(err),
      },
    };
    res.status(400).json(body);
    return;
  }

  // Anything past this point is unexpected: log it with the stack, and never
  // leak internal detail to the client in production.
  logger.error({ err, method: req.method, path: req.path }, 'unhandled request error');

  const body: ApiErrorBody = {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: isProduction
        ? 'An unexpected error occurred'
        : String((err as Error)?.message ?? err),
    },
  };
  res.status(500).json(body);
};
