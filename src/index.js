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

        const url = options?.url;

        if (!url || url.match(/redis:\/\//g) === null) {
            throw new Error("[@joaootavios/redis-map] Invalid redis url!");
        };

        this.#redis = redis.createClient({ url, ...options?.redisOptions });
        this.#pubsub = this.#redis.duplicate();
        this.#monitor = options?.monitor;

        this.#redis.on("connect", () => this.#log("state", "[@joaootavios/redis-map] Redis client connected!"));
        this.#pubsub.on("connect", () => this.#log("state", "[@joaootavios/redis-map] Redis pubsub connected!"));

        this.#redis.on("error", (err) => this.#log("error", `[@joaootavios/redis-map] Redis error: ${err}`));
        this.#pubsub.on("error", (err) => this.#log("error", `[@joaootavios/redis-map] Redis pubsub error: ${err}`));

    }

    async connect() {

        if (this.#pubsub.isOpen && this.#redis.isOpen) return;
        await Promise.all([this.#redis.connect(), this.#pubsub.connect()]);

        // Enable expired events for keyspace notifications in all maps.
        this.#pubsub.configSet("notify-keyspace-events", "Ex");

        return {
            redis: this.#redis,
            pubsub: this.#pubsub,
            disconnect: this.disconnect.bind(this)
        }
    }

    async disconnect() {
        if (!this.#pubsub.isOpen && !this.#redis.isOpen) return;
        await Promise.all([this.#redis.quit(), this.#pubsub.quit()]);
    }

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
        this.name = options?.name || "redis-map";
        this.#options = options;
        this.data = {};

        this.#redis = options?.connections.redis;
        this.#pubsub = options?.connections.pubsub;

        if (!(this.#redis.isOpen || this.#pubsub.isOpen)) {
            throw new Error("[@joaootavios/redis-map] Redis client is not connected!");
        };

        if (this.#options?.sync !== false) this.sync();
        this.#subscribe();
    }

    get(key) {
        return this.data[key] || null;
    }

    has(key) {
        return key in this.data;
    }

    entries() {
        return Object.entries(this.data);
    }

    /**
     * Set a value to the map in local cache and redis.
     * @param {String} key
     * @param {*} value
     * @param {Number} expire Expire key in seconds.
     */
    async set(key, value, expire) {
        this.data[key] = value;
        await this.#redis.set(this.name, JSON.stringify(this.data));
        await this.#publish({ action: "set", key, value });
        if (expire) this.#redis.set(`rmap-${this.name}-ex=${key}`, 0, { EX: expire });
    }

    /**
     * Delete a value from the map in local cache and redis.
     * @param {String} key
     */
    async delete(key) {
        delete this.data[key];
        await this.#redis.set(this.name, JSON.stringify(this.data));
        await this.#publish({ action: "delete", key });
    }

    /**
     * WARNING: This method will clear all data from the map in local cache and redis.
     */
    async clear() {
        await this.#publish({ action: "clear" });
    }

    async sync() {
        const data = await this.#redis.get(this.name).catch(() => null);

        if (data) {
            this.data = JSON.parse(data);
            this.#log("info", `[${this.name}] Redis data synced!`);
        }
    }

    #log(type, message) {
        if (this.#options?.monitor) this.#options.monitor(type, message, this.name);
    }

    async #publish(...data) {
        const message = JSON.stringify(...data);
        await this.#redis.publish(this.name, message);
    }

    #subscribe() {

        this.#pubsub.pSubscribe("__keyevent@0__:expired", (data) => {
            if (data.startsWith(`rmap-${this.name}-ex`)) {
                delete this.data[data.split("=")[1]];
            }
        });

        this.#pubsub.subscribe(this.name, (message) => {
            this.#log("info", message);
            const { action, key, value } = JSON.parse(message);

            switch (action) {
                case "set":
                    this.data[key] = value;
                    break;
                case "delete":
                    delete this.data[key];
                    break;
                case "clear":
                    this.#redis.del(this.name);
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