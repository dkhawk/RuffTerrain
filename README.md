# RuffTerrain

RuffTerrain repository using bare git worktree setup.

## Workflow

This repository uses a bare Git repository setup with worktrees.
- The `main` branch is used for releases and stability. Direct commits to `main` are discouraged.
- All development work should be done in feature branches created via `git worktree`.

### Creating a new feature branch

To start work on a new feature, add a new worktree:

```bash
git worktree add -b feature/your-feature-name ../feature-your-feature-name main
```

Or from the root directory:

```bash
git worktree add -b feature/your-feature-name feature-your-feature-name main
```

### Removing a feature branch worktree

Once the feature branch is merged and pushed, you can remove the worktree:

```bash
git worktree remove feature-your-feature-name
```
