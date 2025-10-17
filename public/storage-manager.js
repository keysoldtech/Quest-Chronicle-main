/**
 * Unified Storage Manager for Quest & Chronicle
 * Handles all localStorage and sessionStorage operations with:
 * - Automatic expiration
 * - Version management
 * - Error handling
 * - Consistent key naming
 */

class StorageManager {
    constructor(prefix = 'qc_', version = '1.0') {
        this.prefix = prefix;
        this.version = version;
    }

    /**
     * Save data to storage
     * @param {string} key - Storage key (prefix will be added automatically)
     * @param {*} data - Data to store (will be JSON stringified)
     * @param {object} options - Storage options
     * @param {boolean} options.persistent - Use localStorage (true) or sessionStorage (false)
     * @param {number} options.ttl - Time to live in milliseconds (optional)
     * @returns {boolean} Success status
     */
    save(key, data, options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            const fullKey = this.prefix + key;
            
            const envelope = {
                version: this.version,
                timestamp: Date.now(),
                expiresAt: options.ttl ? Date.now() + options.ttl : null,
                data: data
            };
            
            storage.setItem(fullKey, JSON.stringify(envelope));
            return true;
        } catch (e) {
            console.error(`[Storage] Failed to save ${key}:`, e);
            
            // Handle quota exceeded
            if (e.name === 'QuotaExceededError') {
                console.warn('[Storage] Quota exceeded, attempting cleanup...');
                this.cleanup();
                
                // Try again after cleanup
                try {
                    const storage = options.persistent !== false ? localStorage : sessionStorage;
                    storage.setItem(this.prefix + key, JSON.stringify(envelope));
                    return true;
                } catch (retryError) {
                    console.error('[Storage] Still failed after cleanup:', retryError);
                }
            }
            
            return false;
        }
    }

    /**
     * Load data from storage
     * @param {string} key - Storage key
     * @param {object} options - Load options
     * @param {boolean} options.persistent - Use localStorage (true) or sessionStorage (false)
     * @param {boolean} options.ignoreVersion - Don't check version compatibility
     * @param {boolean} options.removeIfExpired - Auto-remove if expired (default true)
     * @returns {*} Stored data or null if not found/expired/invalid
     */
    load(key, options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            const fullKey = this.prefix + key;
            const raw = storage.getItem(fullKey);
            
            if (!raw) return null;
            
            const envelope = JSON.parse(raw);
            
            // Validate envelope structure
            if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
                console.warn(`[Storage] Invalid envelope for ${key}, removing...`);
                storage.removeItem(fullKey);
                return null;
            }
            
            // Check expiration
            if (envelope.expiresAt && Date.now() > envelope.expiresAt) {
                if (options.removeIfExpired !== false) {
                    storage.removeItem(fullKey);
                }
                return null;
            }
            
            // Check version compatibility
            if (envelope.version !== this.version && !options.ignoreVersion) {
                console.warn(`[Storage] Version mismatch for ${key}: expected ${this.version}, got ${envelope.version}`);
                // Still return data but log warning
            }
            
            return envelope.data;
        } catch (e) {
            console.error(`[Storage] Failed to load ${key}:`, e);
            return null;
        }
    }

    /**
     * Remove item from storage
     * @param {string} key - Storage key
     * @param {object} options - Remove options
     * @param {boolean} options.persistent - Use localStorage (true) or sessionStorage (false)
     * @returns {boolean} Success status
     */
    remove(key, options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            storage.removeItem(this.prefix + key);
            return true;
        } catch (e) {
            console.error(`[Storage] Failed to remove ${key}:`, e);
            return false;
        }
    }

    /**
     * Check if key exists in storage
     * @param {string} key - Storage key
     * @param {object} options - Options
     * @returns {boolean} True if key exists and is not expired
     */
    exists(key, options = {}) {
        const data = this.load(key, { ...options, removeIfExpired: false });
        return data !== null;
    }

    /**
     * Clear all items matching a pattern
     * @param {string|RegExp} pattern - Pattern to match (optional, clears all if not provided)
     * @param {object} options - Clear options
     * @param {boolean} options.persistent - Use localStorage (true) or sessionStorage (false)
     */
    clear(pattern = null, options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            const keysToRemove = [];
            
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                
                // Only consider keys with our prefix
                if (!key.startsWith(this.prefix)) continue;
                
                const shortKey = key.substring(this.prefix.length);
                
                // If pattern provided, check match
                if (pattern) {
                    const matches = pattern instanceof RegExp
                        ? pattern.test(shortKey)
                        : shortKey.includes(pattern);
                    
                    if (matches) {
                        keysToRemove.push(key);
                    }
                } else {
                    keysToRemove.push(key);
                }
            }
            
            keysToRemove.forEach(key => storage.removeItem(key));
            return keysToRemove.length;
        } catch (e) {
            console.error('[Storage] Failed to clear:', e);
            return 0;
        }
    }

    /**
     * Cleanup expired items
     * @param {object} options - Cleanup options
     * @returns {number} Number of items removed
     */
    cleanup(options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            const keysToRemove = [];
            
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                
                if (!key.startsWith(this.prefix)) continue;
                
                try {
                    const raw = storage.getItem(key);
                    const envelope = JSON.parse(raw);
                    
                    // Remove if expired
                    if (envelope.expiresAt && Date.now() > envelope.expiresAt) {
                        keysToRemove.push(key);
                    }
                } catch (parseError) {
                    // Remove invalid/corrupted entries
                    keysToRemove.push(key);
                }
            }
            
            keysToRemove.forEach(key => storage.removeItem(key));
            
            if (keysToRemove.length > 0) {
                console.log(`[Storage] Cleaned up ${keysToRemove.length} expired/invalid items`);
            }
            
            return keysToRemove.length;
        } catch (e) {
            console.error('[Storage] Cleanup failed:', e);
            return 0;
        }
    }

    /**
     * Get storage usage statistics
     * @param {object} options - Options
     * @returns {object} Storage statistics
     */
    getStats(options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            let totalSize = 0;
            let itemCount = 0;
            const items = [];
            
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                
                if (!key.startsWith(this.prefix)) continue;
                
                const value = storage.getItem(key);
                const size = new Blob([value]).size;
                
                totalSize += size;
                itemCount++;
                
                items.push({
                    key: key.substring(this.prefix.length),
                    size: size,
                    sizeKB: (size / 1024).toFixed(2)
                });
            }
            
            return {
                itemCount,
                totalSize,
                totalSizeKB: (totalSize / 1024).toFixed(2),
                totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
                items: items.sort((a, b) => b.size - a.size)
            };
        } catch (e) {
            console.error('[Storage] Failed to get stats:', e);
            return null;
        }
    }

    /**
     * Export all data (for backup/debugging)
     * @param {object} options - Export options
     * @returns {object} All stored data
     */
    exportAll(options = {}) {
        try {
            const storage = options.persistent !== false ? localStorage : sessionStorage;
            const exported = {};
            
            for (let i = 0; i < storage.length; i++) {
                const key = storage.key(i);
                
                if (!key.startsWith(this.prefix)) continue;
                
                const shortKey = key.substring(this.prefix.length);
                exported[shortKey] = this.load(shortKey, options);
            }
            
            return exported;
        } catch (e) {
            console.error('[Storage] Export failed:', e);
            return null;
        }
    }

    /**
     * Import data (for restore/migration)
     * @param {object} data - Data to import
     * @param {object} options - Import options
     * @returns {number} Number of items imported
     */
    importAll(data, options = {}) {
        try {
            let imported = 0;
            
            for (const [key, value] of Object.entries(data)) {
                if (this.save(key, value, options)) {
                    imported++;
                }
            }
            
            console.log(`[Storage] Imported ${imported} items`);
            return imported;
        } catch (e) {
            console.error('[Storage] Import failed:', e);
            return 0;
        }
    }
}

// Create singleton instance
const storageManager = new StorageManager();

// Auto-cleanup on page load
storageManager.cleanup();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StorageManager, storageManager };
}

