/**
 * Error Service - Centralized error handling for client-side
 * Provides consistent error handling, logging, and tracking
 */

class ErrorService {
    constructor(options = {}) {
        this.errors = [];
        this.maxErrors = options.maxErrors || 100;
        this.enableConsole = options.enableConsole !== false;
        this.enableTracking = options.enableTracking !== false;
        this.onError = options.onError || null; // Callback for each error
    }

    /**
     * Wrap a function with error handling
     * @param {Function} fn - Function to wrap
     * @param {object} context - Context information about the function
     * @returns {Function} Wrapped function
     */
    wrap(fn, context = {}) {
        const self = this;
        
        return function wrappedFunction(...args) {
            try {
                const result = fn.apply(this, args);
                
                // Handle async functions
                if (result && typeof result.then === 'function') {
                    return result.catch(error => {
                        self.handleError(error, context);
                        throw error; // Re-throw for caller
                    });
                }
                
                return result;
            } catch (error) {
                self.handleError(error, context);
                throw error; // Re-throw for caller
            }
        };
    }

    /**
     * Wrap a function and suppress errors (show toast instead)
     * @param {Function} fn - Function to wrap
     * @param {object} context - Context information
     * @param {string} fallbackMessage - Message to show if error occurs
     * @returns {Function} Wrapped function
     */
    wrapSafe(fn, context = {}, fallbackMessage = 'An error occurred') {
        const self = this;
        
        return function safewrappedFunction(...args) {
            try {
                const result = fn.apply(this, args);
                
                // Handle async functions
                if (result && typeof result.then === 'function') {
                    return result.catch(error => {
                        self.handleError(error, context);
                        if (typeof showToast === 'function') {
                            showToast(fallbackMessage, 'error');
                        }
                        return null; // Don't re-throw
                    });
                }
                
                return result;
            } catch (error) {
                self.handleError(error, context);
                if (typeof showToast === 'function') {
                    showToast(fallbackMessage, 'error');
                }
                return null; // Don't re-throw
            }
        };
    }

    /**
     * Handle an error
     * @param {Error} error - The error object
     * @param {object} context - Context information
     */
    handleError(error, context = {}) {
        const errorInfo = {
            message: error.message || 'Unknown error',
            stack: error.stack,
            timestamp: Date.now(),
            context: context,
            type: error.constructor.name,
            code: error.code || null,
            userFriendly: error.userFriendly || false
        };

        // Log to console if enabled
        if (this.enableConsole) {
            const contextStr = context.action ? `[${context.action}]` : '[Error]';
            console.error(contextStr, errorInfo.message);
            if (errorInfo.stack) {
                console.error(errorInfo.stack);
            }
            if (Object.keys(context).length > 0) {
                console.error('Context:', context);
            }
        }

        // Store for tracking if enabled
        if (this.enableTracking) {
            this.errors.push(errorInfo);
            if (this.errors.length > this.maxErrors) {
                this.errors.shift(); // Remove oldest
            }
        }

        // Call custom error handler if provided
        if (this.onError) {
            try {
                this.onError(errorInfo);
            } catch (callbackError) {
                console.error('[ErrorService] Error in onError callback:', callbackError);
            }
        }

        // Could integrate with external services here
        // this.sendToSentry(errorInfo);
        // this.sendToLogRocket(errorInfo);
    }

    /**
     * Manually log an error
     * @param {Error|string} error - Error object or message
     * @param {object} context - Context information
     */
    log(error, context = {}) {
        const errorObj = error instanceof Error 
            ? error 
            : new Error(error);
        
        this.handleError(errorObj, context);
    }

    /**
     * Get recent errors
     * @param {number} limit - Number of errors to retrieve
     * @returns {Array} Recent errors
     */
    getRecentErrors(limit = 10) {
        return this.errors.slice(-limit);
    }

    /**
     * Get all errors
     * @returns {Array} All tracked errors
     */
    getAllErrors() {
        return [...this.errors];
    }

    /**
     * Get errors by type
     * @param {string} type - Error type name
     * @returns {Array} Matching errors
     */
    getErrorsByType(type) {
        return this.errors.filter(e => e.type === type);
    }

    /**
     * Get errors by action
     * @param {string} action - Action name
     * @returns {Array} Matching errors
     */
    getErrorsByAction(action) {
        return this.errors.filter(e => e.context.action === action);
    }

    /**
     * Get error statistics
     * @returns {object} Error statistics
     */
    getStats() {
        const stats = {
            totalErrors: this.errors.length,
            byType: {},
            byAction: {},
            recentErrors: this.errors.slice(-10)
        };

        this.errors.forEach(error => {
            // Count by type
            stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
            
            // Count by action
            if (error.context.action) {
                stats.byAction[error.context.action] = (stats.byAction[error.context.action] || 0) + 1;
            }
        });

        return stats;
    }

    /**
     * Clear all tracked errors
     */
    clearErrors() {
        this.errors = [];
    }

    /**
     * Export errors for analysis
     * @returns {string} JSON string of all errors
     */
    export() {
        return JSON.stringify({
            exportDate: new Date().toISOString(),
            errorCount: this.errors.length,
            errors: this.errors
        }, null, 2);
    }

    /**
     * Set up global error handlers
     */
    setupGlobalHandlers() {
        const self = this;

        // Catch unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            self.handleError(
                event.reason instanceof Error ? event.reason : new Error(event.reason),
                { type: 'unhandledRejection', global: true }
            );
        });

        // Catch uncaught errors
        window.addEventListener('error', (event) => {
            self.handleError(
                new Error(event.message),
                {
                    type: 'uncaughtError',
                    global: true,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno
                }
            );
        });

        console.log('[ErrorService] Global error handlers installed');
    }

    /**
     * Create a context-bound error handler
     * @param {object} context - Default context for this handler
     * @returns {object} Handler with pre-bound context
     */
    createContextHandler(context) {
        return {
            wrap: (fn) => this.wrap(fn, context),
            wrapSafe: (fn, message) => this.wrapSafe(fn, context, message),
            log: (error) => this.log(error, context)
        };
    }
}

// Custom error types for better error handling
class NetworkError extends Error {
    constructor(message, statusCode = null) {
        super(message);
        this.name = 'NetworkError';
        this.statusCode = statusCode;
        this.userFriendly = true;
    }
}

class ValidationError extends Error {
    constructor(message, field = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
        this.userFriendly = true;
    }
}

class GameStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GameStateError';
        this.userFriendly = true;
    }
}

// Create singleton instance
const errorService = new ErrorService({
    enableConsole: true,
    enableTracking: true,
    maxErrors: 100,
    onError: (errorInfo) => {
        // Show user-friendly errors as toasts
        if (errorInfo.userFriendly && typeof showToast === 'function') {
            showToast(errorInfo.message, 'error');
        }
    }
});

// Set up global handlers
if (typeof window !== 'undefined') {
    errorService.setupGlobalHandlers();
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ErrorService,
        errorService,
        NetworkError,
        ValidationError,
        GameStateError
    };
}

