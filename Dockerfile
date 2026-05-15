# Specify the base Docker image
FROM apify/actor-node:22

# Check preinstalled packages
RUN npm ls @crawlee/core apify puppeteer playwright

# Copy just package.json and lockfile for layer caching
COPY --chown=myuser:myuser package.json pnpm-lock.yaml ./

# Install packages
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && rm -r ~/.npm

# Copy source
COPY --chown=myuser:myuser . ./

# Run the Actor
CMD ["npx", "tsx", "src/scraper.ts"]
