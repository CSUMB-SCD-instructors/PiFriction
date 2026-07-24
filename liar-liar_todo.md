# Change Detective ("Liar-Liar") follow-up work

## 1. Verify scheduled flaws

The extension currently controls *when* a fault exercise is scheduled, but the model creates the actual flawed candidate. It may fail to introduce a flaw, introduce multiple flaws, or make one that is irrelevant. In the worst case, a student approves a genuinely correct edit and Pi claims there was a missed issue.

Future options:

- Use a structured proposal/review protocol with a hidden defect classification.
- Use a second evaluator to verify the candidate actually contains the intended defect.
- Define deterministic, assignment-specific fault patterns.

## 2. Enforce change size

The mode supports multi-edit calls, but Pi can still submit multiple replacements in one candidate. Consider enforcing one localized replacement per review:

```ts
event.input.edits.length === 1
```

Keep multi-edit support if a small logical change genuinely needs multiple nearby replacements.

## 3. Dedicated review UI

Capture and display the review context structurally instead of relying on transcript context:

- intended goal;
- affected file/function;
- proposed diff;
- `Looks good` action;
- `Something is wrong` action plus diagnosis field.

This should reduce transcript clutter and make the exercise feel intentional.

## 4. Non-TUI fallback

Current review uses TUI `select()` and text-input dialogs. Define fallback behavior for JSON, print, and RPC modes.

## 5. Restricted test/verification stage

After an approved edit, add a constrained verification tool. It should run configured or allowlisted test commands without permitting arbitrary shell commands or file mutation.

## 6. Structured review log / analytics

Persist review events with `pi.appendEntry()`:

- proposed changes;
- approvals/rejections;
- student diagnoses;
- scheduled fault exercises;
- whether a fault was caught.

Later, route this through the planned classroom proxy for instructor analytics.

## 7. Confirm mode switches with pending review

Switching away from Change Detective resets pending approval/correction state. Consider a confirmation dialog when a review is in progress.

## 8. Continue reducing model verbosity

Prompt constraints help but are not perfect. The dedicated review UI should own compact presentation rather than relying on the model to narrate the workflow.
