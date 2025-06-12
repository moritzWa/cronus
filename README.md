# whatdidyougetdonetoday

A modern SaaS template with authentication, payments, and a beautiful UI. This template was originally built as an AI-powered spreadsheet tool, which is why you might notice some table-related naming conventions in the codebase.

## Tech Stack

### Core Technologies

- 🚀 **Bun** - Fast JavaScript runtime and package manager
- 🔄 **Monorepo Structure** with workspaces (client, server, shared)
- 📱 **React** + **TypeScript** for the frontend
- 🎨 **Tailwind CSS** + **Shadcn UI** for styling
- 🔐 **tRPC** for type-safe API calls
- 💳 **Stripe** for payments
- 📊 **MongoDB** for database

### Key Libraries

- **Craco** - Used for customizing Create React App configuration without ejecting
- **Lucide React** - Icon library
- **React Router** - Client-side routing
- **React Query** - Data fetching and caching
- **Zod** - Schema validation

## Project Structure

```
.
├── client/                 # React frontend
│   ├── src/               # Source code
│   ├── craco.config.js    # Craco configuration for CRA customization
│   └── package.json       # Frontend dependencies
├── server/                # Backend server
│   ├── src/              # Source code
│   └── package.json      # Backend dependencies
└── shared/               # Shared types and utilities
    ├── types.ts         # Shared TypeScript types
    └── package.json     # Shared package configuration
├── electron-app/           # Electron desktop application
│   ├── src/                # Source code (main, preload, renderer)
│   └── package.json        # Electron app dependencies
```

## Getting Started

### Prerequisites

- Bun (latest version)
- MongoDB
- Stripe account
- Google OAuth credentials

### Environment Variables

Contact the project maintainer to get the required environment variables. You'll need to set up:

- MongoDB connection string
- Stripe API keys
- Google OAuth credentials
- Other service-specific keys

### Installation

1. Clone the repository

```bash
git clone https://github.com/your-username/whatdidyougetdonetoday-ai.git
cd whatdidyougetdonetoday-ai
```

2. Install dependencies

```bash
bun install
```

3. Start the development servers

For the frontend (in the client directory):

```bash
cd client
bun dev
```

For the backend (in the server directory):

```bash
cd server
bun dev
```

### Running the Server and Electron App Together

To run both the backend server and the Electron application concurrently for development:

```bash
bun run dev:electron-server
```

## Monorepo Structure

This project uses a monorepo structure with three main packages:

### Client (`/client`)

- Built with Create React App + Craco
- Uses Tailwind CSS for styling
- Implements Shadcn UI components
- Handles all frontend logic and UI

### Server (`/server`)

- Bun-based backend
- tRPC for type-safe API endpoints
- MongoDB integration
- Handles authentication and payments

### Shared (`/shared`)

- Contains shared TypeScript types
- Used by both client and server
- Ensures type safety across the stack

### Electron App (`/electron-app`)

- A desktop application built with Electron, React, and TypeScript.
- Provides a native desktop experience.
- For more details, see the [Electron App README](./electron-app/README.md).

## Customization

Search for "PROJECT_NAME" in the codebase to find all instances that need to be replaced with your own brand name. Key files to check:

- `client/src/components/LandingPage.tsx`
- `client/src/App.tsx`
- `client/src/components/navbar.tsx`
- `server/src/index.ts`

## Deployment

The application is set up as a monorepo with separate client and server packages:

- Frontend: Deploy the `client` directory to a static hosting service
- Backend: Deploy the `server` directory to a Node.js hosting service

---

## Deployment on Render

This project is set up for easy deployment on [Render](https://render.com/). Below are the recommended settings for both the client and server services.

### Client (Static Site)

- **Root Directory:** `client`
- **Publish Directory:** `client/build`
- **Build Command:**

  ```sh
  cd client && bun install && bun add -d @craco/craco ajv ajv-keywords && bun run build
  ```

  This command installs dependencies, ensures required build tools are present, and builds the React app.

- **Redirect and Rewrite Rules:**  
  To support client-side routing (React Router), add the following rule:

  | Source | Destination | Action  |
  | ------ | ----------- | ------- |
  | /\*    | /index.html | Rewrite |

  This ensures all routes are handled by your React app.

### Server (Web Service)

- **Root Directory:** `server`
- **Build Command:**
  ```sh
  bun install && bun run build
  ```
- **Start Command:**
  ```sh
  bun start
  ```

> **Note:**  
> The previous project was called "deeptable" (as seen in the screenshots), so you may see references to that name in Render or in some configuration files. You can safely update these to your new project name.

---

## Building and Running the Electron App

There are two primary ways to build the Electron app: a simple, unsigned build for local testing, and a full, signed, and notarized build for production.

### Local Development Build (Unsigned)

For quick local testing, you can create an unsigned build. This does not require any Apple Developer credentials.

1.  **Build the app:**

    ```bash
    cd electron-app
    bun run build:mac
    ```

    This command skips the code signing and notarization steps.

2.  **Open the app:**
    The previous command creates a `.dmg` file in the `electron-app/dist/` directory. To build and open it automatically, you can use the new helper script:
    ```bash
    cd electron-app
    bun run build:mac:open
    ```

### Production Build (Signed & Notarized)

To distribute the application, you must sign it with an Apple Developer ID and have it notarized by Apple.

#### 1. Prerequisites

- An active Apple Developer Account ($99/year).
- The "Developer ID Application" certificate exported from a Mac as a `.p12` file and installed in your local Keychain.
- An App-Specific Password generated from your Apple ID account page.
- Your Apple Team ID from the Developer Portal.

#### 2. Configure Environment Variables

Create a `.env` file in the `electron-app/` directory with your credentials:

```bash
# electron-app/.env

# For Notarization
APPLE_ID=your-apple-id@example.com
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password
```

#### 3. Update Signing Identity

The project is configured to sign with a specific developer identity. Ensure the identity string in the following files matches the "Common Name" of the certificate in your Keychain:

- `electron-app/build/scripts/sign-natives.sh`
- `electron-app/package.json` (in the `build.mac.identity` field)

#### 4. Build the App

Run the build command with the `ENABLE_NATIVE_SIGNING` and `ENABLE_NOTARIZATION` flags set to `true`:

```bash
cd electron-app
ENABLE_NATIVE_SIGNING="true" ENABLE_NOTARIZATION="true" bun run build:mac
```

This command will execute the full pipeline:

- Building the application.
- Signing the native modules.
- Signing the application bundle.
- Uploading the app to Apple for notarization.

### Distribution

The resulting DMG file in `electron-app/dist/` can be distributed directly to users. Because it's signed and notarized, users on macOS will be able to open it without security warnings.
