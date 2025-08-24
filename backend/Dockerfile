FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate || true
COPY src ./src
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "npx prisma generate && npx prisma db push && npm start"]
