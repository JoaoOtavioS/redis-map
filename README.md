## Informações
A simple way to use something similar to the Map in javascript, but synchronized with the power of Redis.

## Install
```
npm install @joaootavios/redis-map
```

## Example of usage
### Machine 01;
```javascript
const RedisMap = require("@joaootavios/redis-map");

const mapInstance = new RedisMap({ name: "my_map", url: REDIS_URL, monitor: (type, message) => {
    console.log(`Monitor: ${type} - ${message}`);
  }
});

// connect to redis to start using the map
await mapInstance.connect();
await mapInstance.set("joaootavios", { plan: "rich", age: 999, power: "god" });
await mapInstance.set("batman", { plan: "?", age: "?" }, 10); // expire in 10 seconds;

console.log(mapInstance.get("joaootavios"));
```

### Machine 02;
```javascript
const RedisMap = require("@joaootavios/redis-map");
const mapInstance = new RedisMap({ name: "my_map", url: REDIS_URL });

// connect to redis to start using the map
await mapInstance.connect();
console.log(mapInstance.get("joaootavios"));
```

## Options
To initialize the RedisMap class, you can use the following options:

```javascript
const RedisMap = require("@joaootavios/redis-map");

const options = {
  name: "my_map",
  url: "redis://localhost:6379",
  autoConnect: true, // default: false
  syncOnConnect: false, // default: true
  redisOptions: {},
  monitor: (type, message) => {
    console.log(`Monitor: ${type} - ${message}`);
  },
};

const myMap = new RedisMap(options);
```

## LICENSE
This project is licensed under the Apache License 2.0