# Agent Context & Workspace Guidelines

This file provides context and operational rules for any AI agent working in the `RuffTerrain` workspace.

## 📌 Critical Directives

1.  **Read PROJECTS.md First**:
    *   You **must** read the [`PROJECTS.md`](file:///Users/dkhawk/Projects/RuffTerrain/PROJECTS.md) file in the workspace root at the beginning of every session. It contains the active project index, goals, current status, and SDK references.
2.  **Log to BUILD_JOURNAL.md**:
    *   You **must** record all key interactions, design decisions, architectural choices, and development progress into the [`BUILD_JOURNAL.md`](file:///Users/dkhawk/Projects/RuffTerrain/BUILD_JOURNAL.md) file in the workspace root.
    *   Append your updates to the end of the file under a new or existing date header.
3.  **Git Worktree Workflow**:
    *   This is a **bare Git repository** setup. The bare repository resides in `.bare/`, and a `.git` file points to it.
    *   The `main/` directory is a worktree representing the stable `main` branch. **Never commit directly to the `main` branch.**
    *   All development work must be done in feature branch worktrees created as siblings of `main/` (e.g. `feature-name/`).
    *   To start work: `git worktree add -b feature/your-feature feature-your-feature main`
4.  **Multi-Computer Continuity Protocol**:
    *   Review [`CONTINUITY.md`](file:///Users/dkhawk/Projects/RuffTerrain/CONTINUITY.md) for the exact protocol on restoring git worktrees and provisioning local API keys across workstations.

## 🛠️ Development & Coding Standards

*   **Platform & Tech**: Android, Kotlin, Jetpack Compose, Google Maps 3D SDK.
*   **Copyright Headers**:
    *   Use the copyright holder **"Google LLC"** (not "Google Inc.").
    *   Confirm the current year is **2026** for all copyright headers.
*   **Separation of Concerns**: Adhere to clean architecture and Android Jetpack guidelines.
