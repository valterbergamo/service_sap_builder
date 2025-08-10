const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');

const projectsRouter = require('./routes/projects');
const embeddingsRouter = require('./routes/embeddings');
const errorHandler = require('./middlewares/error');

const app = express();

// Middlewares básicos e seguros - configurando CSP para permitir inline scripts
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    },
}));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(morgan('tiny'));

// Healthcheck simples
app.get('/health', (_req, res) => res.json({ ok: true }));

// Test (mantendo o que consta no README)
app.get('/test', (_req, res) => res.json({ message: 'ok' }));

// Rotas de projetos
app.use('/projects', projectsRouter);

// Rotas de embeddings
app.use('/embeddings', embeddingsRouter);

// Handler central de erros
app.use(errorHandler);

const path = require('path');

// Servir arquivos estáticos (HTML, CSS, JS)
app.use('/static', express.static(path.join(__dirname, '../public')));

// Rota para a interface de upload
app.get('/upload', (_req, res) => {
	res.sendFile(path.join(__dirname, '../public/upload.html'));
});

module.exports = app;
