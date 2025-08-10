const OpenAI = require('openai');

// Inicializar cliente OpenAI
const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Gerar embedding de um texto usando OpenAI
 * @param {string} text - Texto para gerar embedding
 * @param {string} model - Modelo a usar (padrão: text-embedding-3-small)
 * @returns {Promise<number[]>} Array com o embedding
 */
async function generateEmbedding(text, model = 'text-embedding-3-small') {
	try {
		console.log('🔄 Gerando embedding para texto:', text.substring(0, 100) + '...');
		
		const response = await openai.embeddings.create({
			model: model,
			input: text,
			encoding_format: 'float',
		});

		const embedding = response.data[0].embedding;
		console.log('✅ Embedding gerado com sucesso:', {
			dimensions: embedding.length,
			model: model,
			usage: response.usage
		});

		return embedding;
	} catch (error) {
		console.error('❌ Erro ao gerar embedding:', error.message);
		throw new Error(`Falha ao gerar embedding: ${error.message}`);
	}
}

/**
 * Gerar embeddings em lote
 * @param {string[]} texts - Array de textos
 * @param {string} model - Modelo a usar
 * @returns {Promise<number[][]>} Array de embeddings
 */
async function generateEmbeddings(texts, model = 'text-embedding-3-small') {
	try {
		console.log('🔄 Gerando embeddings em lote:', texts.length, 'textos');
		
		const response = await openai.embeddings.create({
			model: model,
			input: texts,
			encoding_format: 'float',
		});

		const embeddings = response.data.map(item => item.embedding);
		console.log('✅ Embeddings gerados com sucesso:', {
			count: embeddings.length,
			dimensions: embeddings[0]?.length,
			model: model,
			usage: response.usage
		});

		return embeddings;
	} catch (error) {
		console.error('❌ Erro ao gerar embeddings em lote:', error.message);
		throw new Error(`Falha ao gerar embeddings: ${error.message}`);
	}
}

/**
 * Limpar e preparar texto para embedding
 * @param {string} text - Texto bruto
 * @returns {string} Texto limpo
 */
function cleanTextForEmbedding(text) {
	return text
		.replace(/\s+/g, ' ') // Múltiplos espaços -> um espaço
		.replace(/\n+/g, '\n') // Múltiplas quebras -> uma quebra
		.trim() // Remove espaços das bordas
		.substring(0, 8000); // Limita tamanho (OpenAI tem limite)
}

/**
 * Dividir texto grande em chunks menores
 * @param {string} text - Texto completo
 * @param {number} maxChunkSize - Tamanho máximo do chunk
 * @param {number} overlap - Sobreposição entre chunks
 * @returns {string[]} Array de chunks
 */
function splitTextIntoChunks(text, maxChunkSize = 1000, overlap = 100) {
	const chunks = [];
	let start = 0;

	while (start < text.length) {
		let end = start + maxChunkSize;
		
		// Se não é o último chunk, tenta quebrar em uma palavra
		if (end < text.length) {
			const lastSpace = text.lastIndexOf(' ', end);
			if (lastSpace > start) {
				end = lastSpace;
			}
		}

		chunks.push(text.substring(start, end).trim());
		start = end - overlap;
	}

	return chunks.filter(chunk => chunk.length > 0);
}

module.exports = {
	generateEmbedding,
	generateEmbeddings,
	cleanTextForEmbedding,
	splitTextIntoChunks
};