## PROJECT OVERVIEW

This project is an Electron-based desktop application designed to streamline the workflow for contributing to the `melee` game decompilation project. It serves as a helper tool that guides a developer through the entire process, from initial environment setup to local verification and final submission.

The dashboard simplifies complex command-line tasks into a user-friendly graphical interface, featuring a unified single-page layout with persistent sidebar navigation for a fluid and modern user experience.

**Core Features:**

*   **Guided Setup & Self-Healing:** Automates cloning the `melee` repository, locating a `main.dol` file, configuring the project with `configure.py`, and running the initial `ninja` build. The process automatically verifies required toolchains.
*   **Persistent Paths:** Remembers the user's selected Project Folder and `main.dol` path between sessions for convenience.
*   **Automatic Toolchain Management:** If `ninja` is missing, it is automatically installed via `pip`. If `objdiff-cli` is missing, it is automatically downloaded into the project folder, ensuring a clean and self-contained environment.
*   **Struct Inspector:** Accelerates the matching process by parsing project headers to suggest C syntax (like `gobj->user_data`) for a given assembly memory access.
*   **Verification Dashboard:** An integrated UI for `objdiff-cli`. Provides a project-wide, color-coded report of matching progress for every object file, with drill-down views for non-matching functions.
*   **Integrated AI Copilot:** Utilizes Google's Gemini Pro via the `gcloud` CLI to provide intelligent C code refactoring suggestions. Given a non-matching function, the AI analyzes the target assembly and existing C code to propose changes that will lead to a perfect match.
*   **Decompilation Helper:** For a selected function, it automatically extracts the relevant assembly code and C header context, ready to be copied into [decomp.me](https://decomp.me).
*   **Intelligent Code Injection:** Allows users to paste their matched C code. The application intelligently finds and replaces the corresponding function stub in both the C source file and the header file.
*   **One-Click Revert:** A dedicated button to revert any code injections for the currently selected file using `git restore`.
*   **Manual Configuration:** Provides a settings page to manually specify paths for `git.exe`, `python.exe`, `ninja.exe`, and `objdiff-cli.exe`.

## FILE STRUCTURE

The project has been refactored into a single-page application architecture for a more cohesive user experience and easier maintenance.

```
decomp-dashboard/
├── assets/
│   └── icon.png
├── src/
│   ├── index.html         // The main and only HTML file for the UI
│   ├── preload.js         // Secure bridge between the main and renderer processes
│   ├── renderer.js        // Consolidated JavaScript for all UI views
│   ├── setup-handler.js   // Backend logic for project setup and toolchain verification
│   └── style.css          // Centralized CSS for all UI components
├── .gitignore
├── LICENSE
├── main.js                // Main Electron process, handles windows and backend IPC
├── package.json
└── README.md
```

## GETTING STARTED

Follow these instructions to get a copy of the project up and running on your local machine.

### Prerequisites

*   [Node.js](https://nodejs.org/) and npm
*   [Git](https://git-scm.com/)
*   [Python](https://www.python.org/)
*   **Google Cloud CLI**: The AI Copilot feature requires `gcloud` to be installed and authenticated.
    *   [Install the Google Cloud CLI](https://cloud.google.com/sdk/docs/install).
    *   After installation, authenticate your user account by running: `gcloud auth application-default login`
*   **Note on `ninja` & `objdiff-cli`**: You do not need to install `ninja` or `objdiff-cli` beforehand. The application will automatically install or download them if they are not found on your system's `PATH`.

### Installation

1.  Clone the repository to your local machine:
    ```sh
    git clone <YOUR_REPOSITORY_URL>
    cd decomp-dashboard
    ```

2.  Install the required npm packages. The `dotenv` package is used for managing Google Cloud credentials for the AI feature.
    ```sh
    npm install
    npm install dotenv
    ```

3.  Configure your environment variables for the AI Copilot. Create a file named `.env` in the project root and populate it according to the `ENVIRONMENT VARIABLES` section below.

### Running the Application

To start the application in development mode, run the following command:

```sh
npm start
```

This will launch the Electron window and the application.

## ENVIRONMENT VARIABLES

While the application is designed to be self-contained for end-users, development of the AI Copilot feature requires environment variables. Create a `.env` file in the root of the project by copying the example template below and filling in your project details.

### `.env.example`
```
# Google Cloud Configuration for the AI Copilot
# Your Google Cloud Project ID
GCLOUD_PROJECT_ID=your-gcp-project-id
# The location of your AI Platform resources (e.g., us-central1)
GCLOUD_LOCATION=us-central1
# The specific Gemini model to use
GCLOUD_MODEL_ID=gemini-1.0-pro
```

### User Settings
All user-specific paths are managed by `electron-store` and saved automatically.

*   **Toolchain Paths**: The application auto-detects `git`, `python`, `ninja`, and `objdiff-cli`. These can be manually overridden on the Settings page.
*   **Project Paths**: The last used Project Folder and `main.dol` path are saved for convenience.

## KEY PACKAGES

*   **`electron`** (dev dependency): The core framework used to build this cross-platform desktop application.
*   **`electron-store`**: Used to persistently store user settings like toolchain and project paths.
*   **`electron-builder`** (dev dependency): A tool for packaging and distributing the Electron application.
*   **`dotenv`**: Used to load environment variables from a `.env` file for development, specifically for Google Cloud credentials.
*   **Node.js `child_process`**: Used to execute external command-line tools like `git`, `py`, `ninja`, `gcloud`, and `objdiff-cli`.
*   **Node.js `fs` and `path`**: Used for all file system interactions, including creating helper scripts and parsing C header files.

## SECURITY NOTES

*   **Context Isolation**: The application is configured with `contextIsolation: true` and `nodeIntegration: false` to ensure the renderer process cannot directly access Node.js APIs.
*   **Preload Script**: Communication between the UI and the backend is handled exclusively through a `preload.js` script, which uses `contextBridge` to securely expose specific functions.
*   **Command Execution**: The application executes shell commands based on hardcoded templates. Any user-provided data (like file paths) is supplied via secure system dialogs, mitigating the risk of command injection.
*   **AI Command Execution**: The AI Copilot feature executes the `gcloud` command-line tool. The prompt sent to the AI is constructed programmatically and written to a temporary file. This avoids passing complex, user-editable code directly on the command line, reducing injection risks.

## DEPLOYMENT NOTES

To package this Electron application into a distributable format (e.g., `.exe` for Windows), use the `build` script in `package.json`.

```sh
npm run build
```

This will generate a `dist/` folder containing the packaged application.

## TESTING

This project does not yet have an automated test suite. Testing is currently performed manually by running the application and verifying its features, including the setup and AI Copilot workflows.
