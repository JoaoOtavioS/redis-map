// Created with ❤️ by @joaootavios
const redis = require("redis");

class RedisMap {
    #redis;
    #pubsub;
    #options;

    /**
     * Initialize the RedisMap class.
     * @param {Object} options Options.
     * @param {String} options.name Name of the map. (Default: redis-map).
     * @param {String} options.url Redis url. (Default: redis://localhost:6379).
     * @param {Boolean} options.autoConnect Connect to redis on initialize. (Default: false).
     * @param {Boolean} options.syncOnConnect Sync data on connect. (Default: true).
     * @param {Object} options.redisOptions Redis options. (Default: {}).
     * @param {Function} options.monitor Callback function. Args: (type = "state / info / error", message = string).
     */
    constructor(options = { url: "redis://localhost:6379" }) {
        this.name = options?.name || "redis-map";
        this.#options = options;
        this.data = {};

        this.#redis = redis.createClient({ url: options?.url, ...(options?.redisOptions || {}) });
        this.#pubsub = redis.createClient({ url: options?.url, ...(options?.redisOptions || {}) });

        this.#redis.on("connect", () => this.#log("state", `[${this.name}] Redis client connected!`));
        this.#pubsub.on("connect", () => this.#log("state", `[${this.name}] Redis pubsub connected!`));

        this.#redis.on("error", (err) => this.#log("error", `[${this.name}] Redis error: ${err}`));
        this.#pubsub.on("error", (err) => this.#log("error", `[${this.name}] Redis pubsub error: ${err}`));

        if (options.autoConnect === true) this.connect();
    }

    async connect() {
        if (!this.#redis.isOpen && !this.#pubsub.isOpen) {
            await Promise.all([this.#redis.connect(), this.#pubsub.connect()]);
            if (this.#options?.syncOnConnect !== false) {
                await this.#sync();
                this.#log("info", `[${this.name}] Redis data synced!`);
            }
            this.#subscribe();
        }
    }

    async disconnect() {
        await Promise.all([this.#redis.quit(), this.#pubsub.quit()]);
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

    #log(type, message) {
        if (this.#options?.monitor) this.#options.monitor(type, message);
    }

    async #publish(...data) {
        const message = JSON.stringify(...data);
        await this.#redis.publish(this.name, message);
    }

    async #sync() {
        const data = await this.#redis.get(this.name);

        if (data) {
            this.data = JSON.parse(data);
        }
    }

    #subscribe() {

        this.#pubsub.configSet("notify-keyspace-events", "Ex");

        this.#pubsub.pSubscribe("__keyevent@0__:expired", (data) => {
            if (data.startsWith(`rmap-${this.name}-ex`)) {
                delete this.data[data.split("=")[1]];
            }
        });

        this.#pubsub.subscribe(this.name, (message) => {
            if (this.#options?.monitor) this.#options.monitor("info", message);
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

module.exports = RedisMap;