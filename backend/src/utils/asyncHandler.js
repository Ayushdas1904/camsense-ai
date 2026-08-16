/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error-handling middleware instead of crashing the process. Removes the need
 * for a try/catch in every controller.
 */
export const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};
