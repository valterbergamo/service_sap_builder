FROM node:18-alpine

# Criar usuário e diretórios com permissões corretas
RUN mkdir -p /home/node/app/node_modules /home/node/app/projects && \
    chown -R node:node /home/node/app

WORKDIR /home/node/app

# Copiar package.json primeiro
COPY package*.json ./

# Instalar dependências como root, depois mudar ownership
RUN npm ci --only=production && \
    chown -R node:node /home/node/app/node_modules

# Copiar código fonte
COPY --chown=node:node . .

# Garantir permissões no diretório projects
RUN chown -R node:node /home/node/app/projects

# Mudar para usuário node
USER node

# Expor porta
EXPOSE 3000

CMD ["npm", "start"]