const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: true, // Required for Azure SQL
    trustServerCertificate: false,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log('Connected to Azure SQL Database');
  }
  return pool;
}

async function query(queryString, params = {}) {
  const p = await getPool();
  const request = p.request();
  Object.entries(params).forEach(([key, value]) => {
    request.input(key, value);
  });
  return request.query(queryString);
}

module.exports = { getPool, query, sql };
