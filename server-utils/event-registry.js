/**
 * Server Event Registry - Centralized socket event management
 * Provides automatic validation, rate limiting, and error handling
 */

const { ValidationError } = require('./action-validator');

class ServerEventRegistry {
    constructor(io, gameManager) {
        this.io = io;
        this.gm = gameManager;
        this.handlers = new Map();
        this.rateLimiters = new Map();
        this.stats = {
            totalEvents: 0,
            eventCounts: {},
            errors: {},
            rateLimitHits: 0
        };
    }

    /**
     * Register an event handler
     * @param {string} eventName - Socket.IO event name
     * @param {Function} handler - Handler function (socket, data) => void
     * @param {object} options - Handler options
     * @param {object} options.schema - Data validation schema (optional)
     * @param {object} options.rateLimit - Rate limiting config {max, window}
     * @param {boolean} options.requireRoom - Require player to be in a room
     * @param {boolean} options.requireTurn - Require it to be player's turn
     * @param {boolean} options.logData - Log event data (default false for privacy)
     */
    register(eventName, handler, options = {}) {
        if (this.handlers.has(eventName)) {
            console.warn(`[Registry] Overwriting existing handler for: ${eventName}`);
        }

        // Wrap handler with middleware
        const wrappedHandler = this.wrapHandler(eventName, handler, options);
        
        this.handlers.set(eventName, {
            handler: wrappedHandler,
            options: options,
            callCount: 0
        });

        console.log(`[Registry] Registered: ${eventName}`);
    }

    /**
     * Wrap handler with middleware (validation, rate limiting, error handling)
     */
    wrapHandler(eventName, handler, options) {
        const self = this;
        
        return async function(socket, data) {
            const startTime = Date.now();
            
            try {
                // Update stats
                self.stats.totalEvents++;
                self.stats.eventCounts[eventName] = (self.stats.eventCounts[eventName] || 0) + 1;
                
                // Log event (without sensitive data by default)
                if (options.logData) {
                    console.log(`[Event] ${eventName} from ${socket.id}:`, data);
                } else {
                    console.log(`[Event] ${eventName} from ${socket.id}`);
                }

                // Rate limiting
                if (options.rateLimit) {
                    if (!self.checkRateLimit(socket.id, eventName, options.rateLimit)) {
                        self.stats.rateLimitHits++;
                        console.warn(`[RateLimit] ${socket.id} exceeded limit for ${eventName}`);
                        return socket.emit('actionError', 'Too many requests. Please slow down.');
                    }
                }

                // Schema validation
                if (options.schema) {
                    const validation = self.validateSchema(data, options.schema);
                    if (!validation.valid) {
                        console.warn(`[Validation] ${eventName} failed schema:`, validation.errors);
                        return socket.emit('actionError', `Invalid data: ${validation.errors.join(', ')}`);
                    }
                }

                // Room requirement check
                if (options.requireRoom) {
                    const room = self.gm.findRoomBySocket(socket);
                    if (!room) {
                        return socket.emit('actionError', 'You are not in a room');
                    }
                }

                // Turn requirement check
                if (options.requireTurn) {
                    const room = self.gm.findRoomBySocket(socket);
                    const player = room?.players[socket.id];
                    
                    if (!room || !player) {
                        return socket.emit('actionError', 'Player not found');
                    }
                    
                    const currentPlayerId = room.gameState.turnOrder[room.gameState.currentPlayerIndex];
                    if (currentPlayerId !== socket.id) {
                        return socket.emit('actionError', 'Not your turn');
                    }
                }

                // Call actual handler
                await handler.call(self.gm, socket, data);
                
                // Log execution time for performance monitoring
                const duration = Date.now() - startTime;
                if (duration > 1000) { // Log slow operations
                    console.warn(`[Performance] ${eventName} took ${duration}ms`);
                }

            } catch (error) {
                // Track errors
                self.stats.errors[eventName] = (self.stats.errors[eventName] || 0) + 1;
                
                // Handle different error types
                if (error instanceof ValidationError) {
                    console.warn(`[ValidationError] ${eventName}:`, error.message);
                    socket.emit('actionError', error.message);
                } else {
                    console.error(`[Error] ${eventName}:`, error);
                    socket.emit('actionError', 'An unexpected error occurred');
                }
                
                // Clear any pending dice rolls on error
                socket.emit('diceRollError');
            }
        };
    }

    /**
     * Check rate limit for socket + event combination
     * @param {string} socketId - Socket ID
     * @param {string} eventName - Event name
     * @param {object} config - Rate limit config {max, window}
     * @returns {boolean} True if within limit
     */
    checkRateLimit(socketId, eventName, config) {
        const key = `${socketId}:${eventName}`;
        const now = Date.now();
        
        if (!this.rateLimiters.has(key)) {
            this.rateLimiters.set(key, []);
        }
        
        const timestamps = this.rateLimiters.get(key);
        
        // Remove old timestamps outside the window
        const windowStart = now - config.window;
        while (timestamps.length > 0 && timestamps[0] < windowStart) {
            timestamps.shift();
        }
        
        // Check if limit exceeded
        if (timestamps.length >= config.max) {
            return false;
        }
        
        // Add current timestamp
        timestamps.push(now);
        
        return true;
    }

    /**
     * Validate data against schema
     * @param {*} data - Data to validate
     * @param {object} schema - Schema definition
     * @returns {object} {valid: boolean, errors: string[]}
     */
    validateSchema(data, schema) {
        const errors = [];
        
        if (!data || typeof data !== 'object') {
            return { valid: false, errors: ['Data must be an object'] };
        }
        
        for (const [field, type] of Object.entries(schema)) {
            // Handle required fields
            const isRequired = !field.endsWith('?');
            const fieldName = field.replace('?', '');
            
            if (isRequired && !(fieldName in data)) {
                errors.push(`Missing required field: ${fieldName}`);
                continue;
            }
            
            if (fieldName in data) {
                const value = data[fieldName];
                
                // Type checking
                if (type === 'string' && typeof value !== 'string') {
                    errors.push(`${fieldName} must be a string`);
                } else if (type === 'number' && typeof value !== 'number') {
                    errors.push(`${fieldName} must be a number`);
                } else if (type === 'boolean' && typeof value !== 'boolean') {
                    errors.push(`${fieldName} must be a boolean`);
                } else if (type === 'object' && typeof value !== 'object') {
                    errors.push(`${fieldName} must be an object`);
                } else if (type === 'array' && !Array.isArray(value)) {
                    errors.push(`${fieldName} must be an array`);
                }
            }
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Attach all registered handlers to socket.io
     */
    attachAll() {
        this.io.on('connection', (socket) => {
            console.log(`[Connection] ${socket.id} connected`);
            
            // Attach all registered handlers
            this.handlers.forEach((handlerInfo, eventName) => {
                socket.on(eventName, (data) => {
                    handlerInfo.callCount++;
                    handlerInfo.handler(socket, data);
                });
            });
            
            // Log unhandled events (for debugging)
            const handledEvents = new Set([
                'disconnect',
                'disconnecting',
                'error',
                ...this.handlers.keys()
            ]);
            
            socket.onAny((eventName, ...args) => {
                if (!handledEvents.has(eventName)) {
                    console.warn(`[Unhandled Event] ${eventName} from ${socket.id}`);
                    socket.emit('actionError', `Unknown event: ${eventName}`);
                }
            });
        });
        
        console.log(`[Registry] Attached ${this.handlers.size} event handlers`);
    }

    /**
     * Get handler statistics
     * @returns {object} Statistics
     */
    getStats() {
        const handlerStats = {};
        this.handlers.forEach((info, name) => {
            handlerStats[name] = info.callCount;
        });
        
        return {
            ...this.stats,
            handlerCallCounts: handlerStats,
            registeredHandlers: Array.from(this.handlers.keys())
        };
    }

    /**
     * Log statistics
     */
    logStats() {
        console.log('[Registry] Statistics:', JSON.stringify(this.getStats(), null, 2));
    }

    /**
     * Clear rate limiters (useful for testing)
     */
    clearRateLimiters() {
        this.rateLimiters.clear();
    }

    /**
     * Get list of registered event names
     * @returns {string[]} Event names
     */
    getRegisteredEvents() {
        return Array.from(this.handlers.keys());
    }

    /**
     * Check if event is registered
     * @param {string} eventName - Event name to check
     * @returns {boolean} True if registered
     */
    isRegistered(eventName) {
        return this.handlers.has(eventName);
    }
}

// Export
module.exports = { ServerEventRegistry };

