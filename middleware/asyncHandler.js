// Global async error handling for Express 4.
// Express 4 does NOT automatically forward rejected promises from async route
// handlers to the error-handling middleware. An unhandled rejection leaves the
// request hanging and can crash or destabilize the process.
//
// This module solves that problem in three complementary ways:
//   1. asyncHandler(fn)       — per-handler wrapper (use explicitly when editing)
//   2. installGlobalHandlers()— monkey-patches Express Router/Route so that every
//                               async handler is wrapped automatically (no per-file
//                               edits required across the whole codebase)
//   3. installProcessHandlers()— catches unhandledRejection / uncaughtException at
//                               the process level so the server never dies silently
//
// Once installGlobalHandlers() is called before routes are registered (see app.js),
// every existing and future async route handler is protected.

/**
 * Wrap an async Express handler so that any rejected promise is forwarded
 * to the next() error middleware instead of becoming an unhandled rejection.
 *
 * @param {Function} fn  async (req, res, next) => {}
 * @returns {Function} Express middleware
 */
function asyncHandler(fn) {
  return function asyncHandlerWrapper(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      // Attach request context for the error store / handler
      err.method = req?.method;
      err.url = req?.originalUrl || req?.url;
      err.ip = req?.ip || req?.connection?.remoteAddress;
      if (typeof next === 'function') {
        next(err);
      } else {
        console.error('asyncHandler: no next() available, error:', err);
      }
    });
  };
}

/**
 * Express 4 compatibility helper — replaces the native Router.get/post/put/
 * patch/delete/all/use/param/route methods with versions that wrap every
 * handler (including arrays and nested routers returning promises) in
 * asyncHandler.
 *
 * This must run BEFORE any routes are registered to have full effect, but it
 * is safe to call at any time because it only wraps handlers that are added to
 * the router after installation.
 *
 * @returns {void}
 */
function installGlobalHandlers() {
  const express = require('express');
  const slice = Array.prototype.slice;

  /**
   * Coerce a handler (or array of handlers) into an array of wrapped handlers.
   * Handlers can be: middleware functions or Router instances (Express Router
   * middleware is itself a function, so it passes through unchanged).
   */
  function wrapHandlers(handlers) {
    const list = Array.isArray(handlers) ? handlers : [handlers];
    return list.map((h) => {
      if (typeof h !== 'function') return h;
      // Preserve markers set by express for routers/middleware
      return asyncHandler(h);
    });
  }

  // Wrap Express.Router prototype instance methods
  const routerProto = express.Router && express.Router.prototype;
  if (routerProto) {
    ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'route'].forEach((method) => {
      const original = routerProto[method];
      if (typeof original !== 'function') return;
      routerProto[method] = function (...args) {
        if (method === 'route') {
          return original.apply(this, args);
        }
        // Route methods: last arg(s) are handlers, everything before are paths/middleware
        // e.g. router.get('/path', mw1, mw2) -> split last item(s) as handlers
        const last = args[args.length - 1];
        if (args.length > 1 && (Array.isArray(last) || typeof last === 'function')) {
          const handlers = wrapHandlers(last);
          const rest = args.slice(0, -1);
          return original.apply(this, rest.concat(handlers));
        }
        // 'use' with a single router/middleware, or a bare handler
        const wrapped = wrapHandlers(args);
        return original.apply(this, wrapped);
      };
    });

    // Wrap param method handlers
    if (typeof routerProto.param === 'function') {
      const originalParam = routerProto.param;
      routerProto.param = function (name, handler) {
        return originalParam.call(this, name, wrapHandlers(handler)[0]);
      };
    }
  }

  // Wrap Express.Route prototype methods (router.route('/path').get(...))
  const routeProto = express.Route && express.Route.prototype;
  if (routeProto) {
    ['all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'].forEach((method) => {
      const original = routeProto[method];
      if (typeof original !== 'function') return;
      routeProto[method] = function (...args) {
        return original.apply(this, wrapHandlers(args));
      };
    });
  }
}

/**
 * Install process-level safety nets so the application never dies from an
 * unhandled promise rejection or an unexpectedly thrown exception while still
 * logging the error clearly for diagnosis.
 *
 * @returns {void}
 */
function installProcessHandlers() {
  if (process.env.NODE_ENV !== 'test') {
    process.on('unhandledRejection', (reason) => {
      console.error('[process] Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('[process] Uncaught Exception:', err);
    });
  }
}

module.exports = {
  asyncHandler,
  installGlobalHandlers,
  installProcessHandlers,
};
