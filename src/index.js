// Created with ❤️ by @joaootavios
const redis = require("redis");

class RedisAPI {
  #redis;
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
    }

    this.#redis = redis.createClient({ url, ...options?.redisOptions });
    this.#monitor = options?.monitor;

    this.#redis.on("connect", () =>
      this.#log("state", "[@joaootavios/redis-map] Redis client connected!")
    );

    this.#redis.on("error", (err) =>
      this.#log("error", `[@joaootavios/redis-map] Redis error: ${err}`)
    );
  }

  async connect() {
    if (this.#redis.connected) return;

    await this.#redis.connect();

    // Enable expired events for keyspace notifications in all maps.
    this.#redis.config("SET", "notify-keyspace-events", "Ex");

    return {
      redis: this.#redis,
      disconnect: this.disconnect.bind(this),
    };
  }

  async disconnect() {
    if (!this.#redis.connected) return;
    await this.#redis.quit();
  }

  #log(type, message) {
    if (this.#monitor) this.#monitor(type, message);
  }
}

class RedisMap {
  #redis;
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

    if (!this.#redis.connected) {
      throw new Error("[@joaootavios/redis-map] Redis client is not connected!");
    }

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

    const pipeline = this.#redis.multi();
    pipeline.mset(this.name, JSON.stringify(this.data));
    pipeline.publish(this.name, JSON.stringify({ a: 1, key, value }));

    if (expire) {
      pipeline.set(`rmap-${this.name}-ex=${key}`, 0, "EX", expire);
    }

    await pipeline.exec();
  }

  /**
   * Delete a value from the map in local cache and redis.
   * @param {String} key
   */
  async delete(key) {
    delete this.data[key];

    const pipeline = this.#redis.multi();
    pipeline.mset(this.name, JSON.stringify(this.data));
    pipeline.publish(this.name, JSON.stringify({ a: 2, key }));

    await pipeline.exec();
  }

  /**
   * WARNING: This method will clear all data from the map in local cache and redis.
   */
  async clear() {
    this.data = {};

    const pipeline = this.#redis.multi();
    pipeline.del(this.name);
    pipeline.publish(this.name, JSON.stringify({ a: 3 }));

    await pipeline.exec();
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

  #subscribe() {
    this.#redis.psubscribe("__keyevent@0__:expired");

    this.#redis.on("pmessage", (pattern, channel, message) => {
      if (channel === "__keyevent@0__:expired" && message.startsWith(`rmap-${this.name}-ex`)) {
        const key = message.split("=")[1];
        delete this.data[key];
      }
    });

    this.#redis.subscribe(this.name);

    this.#redis.on("message", (channel, message) => {
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
  RedisMap,
};
