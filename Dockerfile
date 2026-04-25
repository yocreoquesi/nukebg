FROM node:22.13.1-slim@sha256:83fdfa2a4de32d7f8d79829ea259bd6a4821f8b2d123204ac467fbe3966450fc AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.3-alpine@sha256:814a8e88df978ade80e584cc5b333144b9372a8e3c98872d07137dbf3b44d0e4
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf

RUN addgroup -S nukebg && adduser -S nukebg -G nukebg \
    && chown -R nukebg:nukebg /var/cache/nginx /var/log/nginx \
    && chown -R nukebg:nukebg /usr/share/nginx/html \
    && touch /var/run/nginx.pid && chown nukebg:nukebg /var/run/nginx.pid

USER nukebg
EXPOSE 8080

# Healthcheck for `docker run` users — docker-compose defines its own
# healthcheck that takes precedence when composed. Kept here so
# `docker run --rm nukebg` is observable too.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8080/ || exit 1
