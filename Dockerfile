# Use an official Node runtime as a base image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY . .

# Install dependencies
RUN yarn



# Command to run the application
CMD ["yarn", "start:dev"]



EXPOSE 3333




# # Stage 1: Build the application
# FROM node:20-alpine AS build-stage

# # Set the working directory in the container
# WORKDIR /app

# # Copy package.json and package-lock.json to the working directory
# COPY package.json yarn.lock ./

# # Install dependencies
# RUN yarn install --frozen-lockfile

# # Copy the rest of the application files
# COPY . .

# # Build the application (modify the command if necessary)
# RUN yarn build

# # Stage 2: Create the final image
# FROM node:20-alpine

# # Set the working directory in the container
# WORKDIR /app

# # Copy the built application from the build stage
# COPY --from=build-stage /app/dist ./dist
# COPY --from=build-stage /app/package.json ./package.json
# COPY --from=build-stage /app/node_modules ./node_modules

# # Command to run the build
# CMD ["npm", "run", "preview"]

# # Expose the port
# EXPOSE 4173





