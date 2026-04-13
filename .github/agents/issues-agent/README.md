# Issues Agent

A custom GitHub Copilot agent that creates GitHub issues from natural language prompts. Instead of creating issues directly, it stages them in a JSON file that gets processed by a GitHub Actions workflow.

## How It Works

1. **You describe the issue** — ask the agent to create a bug report, feature request, or any issue using natural language.
2. **Agent appends to `pending-issues.json`** — the agent parses your request and adds a structured issue object to the queue file in this folder.
3. **Merge to `pending-issues` branch** — commit and push the updated `pending-issues.json` to the `pending-issues` branch.
4. **Workflow creates the issues** — the [`create-issues.yml`](../../workflows/create-issues.yml) workflow runs automatically, creates each issue via the GitHub API, and resets the file to `[]`.

## Usage

In VS Code with GitHub Copilot, select the **Issues Agent** from the agent picker (or let Copilot delegate to it automatically), then describe the issue you want to create:

> "Create an issue to implement idle timeout that returns to the home screen after 5 minutes of inactivity"

The agent will append the issue to `pending-issues.json` with a structured title, body, labels, and any other fields you specify.

## Issue Schema

Each entry in `pending-issues.json` supports:

| Field       | Type       | Required | Description                         |
|-------------|------------|----------|-------------------------------------|
| `title`     | string     | Yes      | Issue title                         |
| `body`      | string     | No       | Markdown issue body                 |
| `labels`    | string[]   | No       | Label names to apply                |
| `assignees` | string[]   | No       | GitHub usernames to assign          |
| `milestone` | number     | No       | Milestone number (positive integer) |

## Prerequisites

- **VS Code** with the [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot) and [GitHub Copilot Chat](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) extensions installed.
- **GitHub Copilot subscription** with access to custom agents (`.agent.md` support).
- **A `pending-issues` branch** in the repository. Create it if it doesn't exist:
  ```bash
  git checkout -b pending-issues
  git push -u origin pending-issues
  ```
- **GitHub Actions enabled** on the repository with write permissions for issues and contents. The workflow uses `GITHUB_TOKEN`, so no additional secrets are required.
- Labels referenced in issues are **auto-created** by the workflow if they don't already exist (with a default gray color).

## Files

| File                  | Purpose                                                  |
|-----------------------|----------------------------------------------------------|
| `issues.agent.md`    | Agent instructions — defines behavior, constraints, and schema |
| `pending-issues.json` | Issue queue — JSON array of issues waiting to be created |

## Example

```json
[
  {
    "title": "Add health check endpoints",
    "body": "Implement startup, liveness, and readiness probe endpoints.\n\n## Acceptance Criteria\n- [ ] `GET /health/startup` returns 200\n- [ ] `GET /health/live` returns 200\n- [ ] `GET /health/ready` validates downstream dependencies",
    "labels": ["enhancement"]
  }
]
```
