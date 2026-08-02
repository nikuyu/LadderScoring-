// db.js
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI env var is not set. Set it before starting the server.');
}

let client;
let dbInstance;

async function getDb() {
  if (dbInstance) return dbInstance;
  client = new MongoClient(uri);
  await client.connect();
  // Uses MONGODB_DBNAME if set, otherwise the db name embedded in the connection string.
  dbInstance = process.env.MONGODB_DBNAME ? client.db(process.env.MONGODB_DBNAME) : client.db();
  await dbInstance.collection('players').createIndex({ name: 1 });
  await dbInstance.collection('rounds').createIndex({ roundNumber: 1 }, { unique: true });
  return dbInstance;
}

module.exports = { getDb };
