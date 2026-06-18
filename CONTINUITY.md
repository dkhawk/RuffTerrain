# Repository Continuity & AI Agent Onboarding Guide

**Copyright 2026 Google LLC**

This document defines the context-preservation architecture, git worktree organization, and exact multi-computer continuity protocol for the `RuffTerrain` repository.

---

## 🧠 1. The Build Journal (`BUILD_JOURNAL.md`)
AI coding assistants and developers moving between workstations start every session with an empty short-term memory window. The `BUILD_JOURNAL.md` file serves as an immutable, shared engineering memory committed directly to Git.

### Anatomy of an Entry
Before finishing any task, a structured entry is appended to `BUILD_JOURNAL.md` capturing:
1.  **Session Header**: Chronological tracking (e.g., `### 🚀 Session 73: Intelligent Diurnal Race Planning...`).
2.  **Goal**: The exact user request, bug fix, or architectural objective.
3.  **Decisions & Rationale (*The Why*)**: Technical explanations of physics formulas, UI patterns, and engineering tradeoffs (adhering to our *literate programming* standard).
4.  **Key Actions & Verification**: Specific files edited and exact verification commands executed (`npm run build`, `./gradlew test`).

---

## 🌳 2. Multi-Platform Git Worktrees
Work in this repository is structured around **Git Worktrees** (`git worktree list`) to enable parallel platform development without branch stashing:
*   `main/`: The stable production web release branch (`main`).
*   `feature-ai-race-planner/`: Active web showcase app development (`feature/web-dialog-fixes`).
*   `android-port/`: Native Android Kotlin / Jetpack Compose / Maps 3D SDK client (`android-port`).

**Worktree Isolation Rule**: Every major worktree maintains its own localized `BUILD_JOURNAL.md`. Always log your session updates to the journal residing in your active working directory.

---

## 🔄 3. The 4-Step Protocol to Resume Work on a New Computer

When cloning or switching to a different workstation, execute this protocol for a 100% consistent experience:

### Step 1: Clone & Fetch
```bash
git clone https://github.com/dkhawk/RuffTerrain.git
cd RuffTerrain
git fetch --all
```

### Step 2: Restore Working Directory
Check out the target platform branch:
*   **Web App**:
    ```bash
    git checkout -t origin/feature/web-dialog-fixes
    npm install
    ```
*   **Android Port**:
    ```bash
    git checkout -t origin/android-port
    ```

### Step 3: Provision Local API Keys (Excluded from Git)
To prevent security leaks, API keys are strictly excluded from git commits. On your new machine:
*   **Web App**: Launch `npm run dev`, open `http://localhost:5173`, click **Open / Import**, and paste your Google Maps Platform key and Gemini API key into the UI dialog (or define `VITE_GMAPS_API_KEY` in a local `.env`).
*   **Android Port**: Create `local.properties` in the Android root containing:
    ```properties
    MAPS_API_KEY=your_maps_api_key_here
    ```

### Step 4: Anchor Your AI Agent (Critical)
When launching a fresh conversation with any AI agent on the new computer, **prefix your initial prompt** with:

> *"Before we begin, review `PROJECTS.md` and read the last 3 session entries at the bottom of `BUILD_JOURNAL.md`. Here is my next request: [describe your task]"*

#### Why this protocol is mandatory:
1.  **Eliminates Context Loss**: The agent immediately absorbs active formulas, architectural states, and styling rules.
2.  **Prevents Hallucination**: It sees approved libraries and patterns, avoiding unauthorized framework injections.
3.  **Seamless Continuity**: Work picks up precisely at the active checkpoint with zero redundant discovery.
