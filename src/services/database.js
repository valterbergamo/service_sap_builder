const { Pool } = require('pg');

// Configuração do pool de conexões PostgreSQL
const pool = new Pool({
	host: process.env.PGHOST,
	port: process.env.PGPORT,
	user: process.env.PGUSER,
	password: process.env.PGPASSWORD,
	database: process.env.PGDATABASE,
	ssl: false, // Ajuste conforme necessário
	max: 20, // Máximo de conexões no pool
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 2000,
});

// Teste de conexão
pool.on('connect', () => {
	console.log('✅ Conectado ao PostgreSQL');
});

pool.on('error', (err) => {
	console.error('❌ Erro no PostgreSQL:', err);
});

// Função para executar queries
async function query(text, params) {
	const start = Date.now();
	try {
		const res = await pool.query(text, params);
		const duration = Date.now() - start;
		console.log('📊 Query executada:', { text, duration, rows: res.rowCount });
		return res;
	} catch (error) {
		console.error('❌ Erro na query:', { text, error: error.message });
		throw error;
	}
}

// Função para transações
async function transaction(callback) {
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const result = await callback(client);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}

module.exports = {
	pool,
	query,
	transaction
};