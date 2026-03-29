FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN addgroup -S nukebg && adduser -S nukebg -G nukebg \
    && chown -R nukebg:nukebg /var/cache/nginx /var/log/nginx \
    && chown -R nukebg:nukebg /usr/share/nginx/html \
    && touch /var/run/nginx.pid && chown nukebg:nukebg /var/run/nginx.pid

USER nukebg
EXPOSE 8080
