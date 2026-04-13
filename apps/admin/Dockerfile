FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /tmp/default.conf.template
EXPOSE 80
ENV API_BACKEND_URL=http://registry-api:3001
CMD ["sh", "-c", "envsubst '${API_BACKEND_URL}' < /tmp/default.conf.template > /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"]
