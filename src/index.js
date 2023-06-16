// Created with ❤️ by @joaootavios
const redis = require("redis");

class RedisAPI {

    #redis;
    #pubsub;
    #monitor;

    /**
     * Initialize the RedisMap class.
     * @param {Object} options Options.
     * @param {String} options.url Redis url.
     * @param {Function} options.monitor Callback function. Args: (type = "state / error", message = string).
     * @param {Object} options.redisOptions Redis options. (Default: {}).
     */
    constructor(options) {

        const url = options && options.url;

        if (!url || !url.match(/redis:\/\//g)) {
            throw new Error("[@joaootavios/redis-map] Invalid redis url!");
        }

        this.#redis = redis.createClient({ url, ...(options && options.redisOptions) });
        this.#pubsub = this.#redis.duplicate();
        this.#monitor = options && options.monitor;

        this.#redis.on("connect", () => {
            this.#log("state", "[@joaootavios/redis-map] Redis client connected!");
        });

        this.#pubsub.on("connect", () => {
            this.#log("state", "[@joaootavios/redis-map] Redis pubsub connected!");
        });

        this.#redis.on("error", (err) => {
            this.#log("error", `[@joaootavios/redis-map] Redis error: ${err}`);
        });

        this.#pubsub.on("error", (err) => {
            this.#log("error", `[@joaootavios/redis-map] Redis pubsub error: ${err}`);
        });

    }

    /**
     * Connect to Redis.
     * @returns {Object} Redis connection information.
     */
    async connect() {
        if (this.#pubsub.isOpen && this.#redis.isOpen) return;

        await Promise.all([
            this.#redis.connect(),
            this.#pubsub.connect()
        ]);

        this.#pubsub.configSet("notify-keyspace-events", "Ex");

        return {
            redis: this.#redis,
            pubsub: this.#pubsub,
            disconnect: this.disconnect.bind(this)
        };
    }

    /**
     * Disconnect from Redis.
     */
    async disconnect() {
        if (!this.#pubsub.isOpen && !this.#redis.isOpen) return;

        await Promise.all([
            this.#redis.quit(),
            this.#pubsub.quit()
        ]);
    }

    /**
     * Log a message.
     * @param {String} type Log type.
     * @param {String} message Log message.
     */
    #log(type, message) {
        if (this.#monitor) this.#monitor(type, message);
    }

}

class RedisMap {
    #redis;
    #pubsub;
    #options;

    /**
     * Initialize the RedisMap class.
     * @param {Object} options Options.
     * @param {String} options.name Name of the map. (Default: redis-map).
     * @param {Boolean} options.sync Sync data from redis on init. (Default: true).
     * @param {Function} options.monitor Callback function. Args: (type = "state / info / error", message = string, name = name of the map).
     */
    constructor(options) {
        this.name = (options && options.name) || "redis-map";
        this.#options = options;
        this.data = {};

        this.#redis = options && options.connections.redis;
        this.#pubsub = options && options.connections.pubsub;

        if (!(this.#redis.isOpen || this.#pubsub.isOpen)) {
            throw new Error("[@joaootavios/redis-map] Redis client is not connected!");
        };

        if (this.#options && this.#options.sync !== false) this.sync();
        this.#subscribe();
    }

    /**
     * Get a value from the map.
     * @param {String} key Key.
     * @returns {*} Value associated with the key, or null if not found.
     */
    get(key) {
        return this.data[key] || null;
    }

    /**
     * Check if a key exists in the map.
     * @param {String} key Key.
     * @returns {Boolean} True if the key exists, false otherwise.
     */
    has(key) {
        return key in this.data;
    }

    /**
     * Get the entries of the map.
     * @returns {Array} Array of [key, value] pairs.
     */
    entries() {
        return Object.entries(this.data);
    }

    /**
     * Set a value to the map in local cache and redis.
     * @param {String} key Key.
     * @param {*} value Value.
     * @param {Number} expire Expire key in seconds.
     */
    async set(key, value, expire) {
        this.data[key] = value;

        const pipeline = this.#redis.multi();

        pipeline.set(this.name, JSON.stringify(this.data));
        pipeline.publish(this.name, JSON.stringify({ a: 1, key: key, value: value }));

        if (expire) {
            pipeline.set(`rmap-${this.name}-ex=${key}`, 0, { EX: expire });
        }

        await pipeline.exec();
    }

    /**
     * Delete a value from the map in local cache and redis.
     * @param {String} key Key.
     */
    async delete(key) {
        delete this.data[key];

        const pipeline = this.#redis.multi();

        pipeline.set(this.name, JSON.stringify(this.data));
        pipeline.publish(this.name, JSON.stringify({ a: 2, key: key }));

        await pipeline.exec();
    }

    /**
     * WARNING: This method will clear all data from the map in local cache and redis.
     */
    async clear() {
        const pipeline = this.#redis.multi();

        pipeline.del(this.name);
        pipeline.publish(this.name, JSON.stringify({ a: 3 }));

        await pipeline.exec();
    }

    /**
     * Sync the map data from Redis.
     */
    async sync() {
        const data = await this.#redis.get(this.name).catch(() => null);

        if (data) {
            this.data = JSON.parse(data);
            this.#log("info", `[${this.name}] Redis data synced!`);
        }
    }

    /**
     * Log a message.
     * @param {String} type Log type.
     * @param {String} message Log message.
     */
    #log(type, message) {
        if (this.#options && this.#options.monitor) {
            this.#options.monitor(type, message, this.name);
        }
    }

    /**
     * Subscribe to pubsub events.
     */
    #subscribe() {

        this.#pubsub.pSubscribe("__keyevent@0__:expired", (data) => {
            if (data.startsWith(`rmap-${this.name}-ex`)) {
                delete this.data[data.split("=")[1]];
            }
        });

        this.#pubsub.subscribe(this.name, (message) => {
            const { a: action, key, value } = JSON.parse(message);
            this.#log("info", { action, key, value });

            switch (action) {
                case 1:
                    this.data[key] = value;
                    break;
                case 2:
                    delete this.data[key];
                    break;
                case 3:
                    this.data = {};
                    break;
            }

        });
    }

}

module.exports = {
    RedisAPI,
    RedisMap
};
