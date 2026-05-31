FROM oven/bun:alpine

WORKDIR /app

# Copy package management files
COPY package.json bun.lock* ./

# Copy the rest of the application
# We copy everything early so bun install can happen with full context if needed, 
# but specifically for Storybook, we mostly need the shared volume later.
COPY . .

# Install dependencies (Optional here if compose handles it, but good for build-time)
RUN bun install

# Expose Storybook port
EXPOSE 6006

# Run Storybook
# We use --host 0.0.0.0 for external access
CMD ["bun", "run", "storybook", "--host", "0.0.0.0", "--ci"]
