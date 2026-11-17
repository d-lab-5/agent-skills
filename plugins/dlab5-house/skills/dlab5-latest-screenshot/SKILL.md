---
name: dlab5-latest-screenshot
description: Look at the user's most recent screenshot(s) when they refer to one without giving a path. Screenshots are in ~/Pictures/Screenshots (GNOME, Windows), else ~/Desktop (macOS). Use for "see the screenshot", "look at the latest screenshot", "as in my screenshot", "I took a screenshot", "see latest in Screenshots", "what's wrong here (screenshot)", "the last two screenshots".
---

# Latest screenshot

When the user mentions a screenshot and gives no path, it is the newest
screenshot on their machine.

## Where they are

| System | Folder | Default name |
|---|---|---|
| Linux (GNOME) | `~/Pictures/Screenshots/` | `Screenshot from YYYY-MM-DD HH-MM-SS.png` |
| Windows | `~/Pictures/Screenshots/` | `Screenshot YYYY-MM-DD HHMMSS.png` |
| macOS | `~/Desktop/` | `Screenshot YYYY-MM-DD at HH.MM.SS.png` |

Use the first folder that exists. If the user named another folder before,
in this conversation or in memory, use that one.

## Steps

1. List the newest files by modification time, screenshots only on macOS's
   Desktop:

   ```bash
   ls -t ~/Pictures/Screenshots | head -3
   ls -t ~/Desktop/Screenshot* | head -3     # macOS
   ```

   Take one unless the user says how many ("the last two screenshots").

2. Open it with the **Read** tool, using the full absolute path (expand `~`).
   Names contain spaces: pass them to Read as they are, and quote them in
   shell commands.

3. Compare the time in the name with the conversation. If the newest one is
   clearly older than the request (hours or days), say which file you looked
   at and when it was taken, in case the one they meant isn't saved yet.

4. Say in one line which screenshot you used, then answer from what it shows.

## Don'ts

- Don't copy, move, rename or delete screenshots.
- Don't upload a screenshot anywhere (an artifact, an issue, a chat service)
  unless the user asks. Screenshots show private data.
- If there is no such folder or it is empty, say so and ask for the path.
  Don't search the whole disk.
