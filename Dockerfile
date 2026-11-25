# Container for hosting Tank Wars (used by Hugging Face Spaces, works on any Docker host)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV PORT=7860 NO_OPEN=1
EXPOSE 7860
CMD ["node", "server.js"]
