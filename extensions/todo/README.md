# Session todos

Use this extension to keep one ordered todo list for the active session branch.
The full list appears above the input field until completion or user abandonment.

## Chat display

Tool results use short status lines instead of raw JSON in the terminal chat.
Start results and approved additions use the theme's success background.
Declined additions use the theme's error background, without marking the tool call as failed.
Start and addition calls use the pending background until they finish.
Updates show only changed tasks.
Additions and switches show the decision and any written feedback.
Approved switches also show both status changes.
Expand a result to see previous statuses or the reason and placement for an addition.
Successful `todo_get` calls stay hidden, even when tool output is expanded.
Errors remain visible.
The agent still receives the full structured tool results.

### Approval prompts

Terminal approval prompts keep the standard bordered selector layout, without backgrounds.
Choice labels, status values, and the proposed addition receive extra color.
Addition prompts show an insertion preview with one existing task above and one below, when available.
Context lines use the theme's muted gray.
The new task has a `+ ` prefix and green text, without a background.
Each switch task and its status transition share one line.
Long task text truncates to keep the transition on that line.
The reason remains visible below the tasks.
Decline is the default choice, and Escape cancels the prompt.
Optional feedback uses a separate input after the decision.
RPC clients use plain prompts with the same task details and inline transitions.

## Tools

### `todo_start`

Create the full initial list:

```json
{
  "items": ["Define the state model", "Add the panel", "Write tests"],
  "in_progress": 1
}
```

`items` is a nonempty array of task text strings.
`in_progress` is an optional 1-based item position.
Without that position, every task starts pending.
The extension assigns IDs such as `t1`, `t2`, and `t3`.
IDs stay fixed within a list, regardless of additions or placement.
An active list cannot be replaced.

Result: the full ordered list with IDs, text, and statuses.

### `todo_update`

Complete one task and start the next task in the same call:

```json
{ "done": "t1", "in_progress": "t2" }
```

Either field can appear alone.
Each field accepts one task ID, not an array.
A task must be in progress before it becomes done.
Only a pending task can become in progress.
Only one task can be in progress at a time.
The same task cannot receive both changes.
There are no automatic status changes.

After a successful update or approved switch, another update needs a successful intervening tool call.
An approved `todo_add` counts.
`todo_get`, declined requests, failed calls, and user messages do not count.
Use `todo_switch` to request approval to switch away from unfinished work.
A failed update does not consume permission for a later valid update.

Result: every changed task, with its ID, text, previous status, and current status.
The result also includes a compact summary and the update permission state.

### `todo_add`

Propose one new pending task:

```json
{
  "text": "Test session restoration",
  "reason": "The initial plan omitted restoration coverage.",
  "after": "t2"
}
```

Supply exactly one placement: `before` or `after`, with an existing task ID.
The approval prompt shows the insertion preview and its reason.
The user can approve or decline, with optional feedback in either case.
An approved addition receives a new ID and starts pending.
It does not change other task statuses.

Result: the decision, optional feedback, proposal, and compact summary.
Approval also returns the new task with its assigned ID and status.
A canceled selection counts as a decline.
An aborted call makes no change.
Without an interactive approval interface, the tool rejects the addition.

### `todo_switch`

Request approval to change which task is in progress:

```json
{
  "in_progress": "t2",
  "reason": "The current task depends on this task."
}
```

The list must contain an in-progress task and a different pending task.
The prompt shows both tasks, both proposed status changes, and the reason.
The user can approve or decline, with optional feedback in either case.
Approval returns the current task to pending and starts the requested task in one atomic change.
It does not mark any task done or change task order.
Decline, cancellation, or missing approval support makes no change.

A switch can request approval even when updates are locked.
Approval consumes update permission, like `todo_update`.
It does not count as an intervening call that unlocks another update.
Decline preserves the existing update permission state.

Result: the decision, optional feedback, proposal, actual status changes, compact summary, and update permission state.
Each change includes the task ID, text, previous status, and current status.
A declined switch returns an empty list of changes.
Reloads and branch navigation restore both status changes and the update permission state.

### `todo_get`

```json
{}
```

Result: the full ordered list with IDs, text, statuses, list phase, and update permission state.
This tool does not unlock `todo_update`.

### `todo_dismiss`

```json
{}
```

Dismiss the list only after every task is done.
Result: confirmation that the completed list is dismissed.
A later `todo_start` can create a new list.

### Tool failures

A rejected operation makes no change.
Its result includes the error, current list, list phase, update permission state, and trial guidance.
Pi marks the result as an error.
The guidance tells the agent to stop and confer with the user when a restriction blocks valid work.

## User escape hatch

Run `/todo abandon` to dismiss a list without completing it.

1. Read the unfinished tasks in the confirmation prompt.
2. Confirm abandonment.
3. Enter an optional reason, or leave it blank.

The extension records the list as abandoned and tells the agent.
Unfinished tasks keep their statuses.
No tool exposes abandonment to the agent.

## Session state

A hidden message follows each normal user prompt.
Its content gives a compact summary.
Its metadata contains the full versioned snapshot, including task IDs, ordering, statuses, and update permission state.
Use `todo_get` when the agent needs the full list in context.

Steering messages also receive a hidden reminder in model context.
The extension saves those reminders as hidden custom entries and restores them for context requests.
This avoids an extra agent turn solely to deliver a reminder.

Every list change also saves a full snapshot immediately.
Reloads and session resumes restore the latest snapshot on the active branch.
Tree navigation restores the state at the selected point, without state from other branches.
Compaction does not delete these snapshots from the session branch.
The full panel remains visible even when all tasks are done, until dismissal.

## Trial restrictions

If a task blocks progress, the agent must stop and confer with the user.
The tools do not support task removal or text changes.
Only an approved `todo_switch` can return an in-progress task to pending.
The update rule checks tool activity, not proof that the task is complete.
