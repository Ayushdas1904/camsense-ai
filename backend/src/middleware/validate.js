import { ApiError } from '../utils/ApiError.js';

/**
 * Request validation middleware backed by a Zod schema.
 * Validates req.body and replaces it with the parsed (typed, defaulted) value.
 *
 *   router.post('/login', validate(loginSchema), controller.login)
 */
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return next(ApiError.badRequest('Validation failed', details));
  }
  req.body = result.data;
  next();
};
