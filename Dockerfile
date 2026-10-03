FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public
COPY data/orders ./data/orders

ENV PORT=5175
EXPOSE 5175

CMD ["node", "server.js"]
