import type { TestCase } from './types';

export const TEST_CASES: TestCase[] = [
  {
    name: 'Simple HTML Landing Page',
    complexity: 'simple',
    prompt: `Create a beautiful landing page for a coffee shop called "Bean There". It should have:
- A warm hero section with the shop name in large text and tagline "Crafted with care since 1987"
- Three feature cards: Fresh Beans, Expert Roasters, Cozy Atmosphere - each with an emoji icon and short description
- A simple footer with "123 Coffee Lane, Portland OR" and "Open 7am-7pm daily"
- Use warm brown (#6B4226) and cream (#FFF8F0) colors with a clean sans-serif font
Keep it as a single index.html file with inline CSS. No JavaScript frameworks needed.`,
    needsBuild: false,
    expectedFiles: ['index.html'],
    verifyDeploy: (html) =>
      html.toLowerCase().includes('bean there') && html.toLowerCase().includes('1987'),
    timeoutMs: 180_000,
  },

  {
    name: 'Interactive Calculator',
    complexity: 'medium',
    prompt: `Build an interactive calculator app as a single HTML file with inline CSS and JavaScript. It should have:
- A display area showing the current input and previous calculation
- Buttons for digits 0-9, operations (+, -, *, /), equals, clear (C), and decimal point
- Chained operations should work (e.g., 2 + 3 * 4)
- Style it with a dark theme (#1a1a2e background, #16213e buttons, #0f3460 operator buttons, #e94560 equals button)
- Rounded buttons with hover effects
- Responsive layout that looks good on mobile
No JavaScript frameworks - just vanilla HTML/CSS/JS in one file.`,
    needsBuild: false,
    expectedFiles: ['index.html'],
    verifyDeploy: (html) => {
      const lower = html.toLowerCase();
      return (lower.includes('calculator') || lower.includes('display') || lower.includes('button'))
        && lower.includes('script');
    },
    timeoutMs: 240_000,
  },

  {
    name: 'React Todo App',
    complexity: 'complex',
    prompt: `Build a React todo app with Tailwind CSS and Vite. Features:
- Add todos with an input field and "Add" button
- Mark todos as complete with a checkbox (strikethrough completed text)
- Delete todos with an X button
- Show count of remaining items at the bottom
- Filter tabs: All / Active / Completed
- Clean, modern design with a centered card on a light gray background
- Empty state message when no todos exist

Use React with JSX (not TypeScript), Vite as bundler, and Tailwind CSS for styling.
Set up the proper vite.config.js, tailwind.config.js, postcss.config.js, and all necessary files.`,
    needsBuild: true,
    expectedFiles: ['index.html', 'package.json'],
    verifyDeploy: (html) =>
      html.includes('<div id="root">') || html.includes('<script'),
    timeoutMs: 480_000,
  },

  {
    name: 'Taskmaster App',
    complexity: 'full',
    prompt: `Build a public, shared todo application called Taskmaster. This is a communal task board where anyone who visits can create tasks, view all tasks, and mark them as completed. There are no user accounts or authentication — it's fully open and collaborative. Think of it like a public whiteboard in a coffee shop where anyone can stick a post-it note.
This is a testing/demo project, so prioritize a polished, delightful user experience over enterprise concerns.

Core Functionality
Creating Tasks

Anyone can add a new task with a text description. Keep it simple — no due dates, no priorities, no assignees. Just the task text.
There should be some reasonable character limit so people don't paste novels in there.
New tasks should appear immediately without a page refresh.
Empty or whitespace-only submissions should be gracefully prevented.

Viewing Tasks

All tasks are visible to everyone. The default view should show incomplete tasks prominently, with completed tasks still accessible but visually de-emphasized.
Tasks should display when they were created, in a human-friendly format (e.g., "2 hours ago," not a raw timestamp).
The list should load fast and feel snappy. If there are many tasks, think about how to handle that gracefully — don't just dump 500 items on the page.

Completing Tasks

Anyone can mark a task as complete. This should feel satisfying — a simple checkbox toggle is fine, but make the interaction feel good (a subtle animation, a strikethrough, something that gives a small dopamine hit).
Completed tasks should be visually distinct from incomplete ones.
Allow toggling back to incomplete in case someone checks the wrong one.

Deleting Tasks

Allow deletion, but make it a deliberate action — not something you'd do accidentally. A confirmation step or an undo mechanism would be appropriate.


Design Direction
Overall Vibe: Clean, modern, and slightly playful. This isn't a corporate enterprise tool — it should feel approachable and fun. Think of the energy of apps like Linear or Todoist, but even more casual and friendly.
Brand & Color:

The name "Taskmaster" should be prominent. Give it a small logomark or icon treatment — something simple but memorable.
Use a bold, saturated accent color as the primary brand color. Avoid anything too muted or corporate.
Dark mode by default is preferred, but a light option is a nice bonus if time allows.

Typography: Use a clean sans-serif. The task text should be very readable. The app name/header can have a bit more personality.
Layout:

Single-page app feel. No routing needed — everything lives on one screen.
Center-column layout with comfortable max-width. Don't let it stretch edge-to-edge on wide monitors.
The input for creating a new task should be prominent and always visible — either pinned at the top or bottom.
On mobile, the experience should be just as good as desktop. Don't treat mobile as an afterthought.

Microinteractions & Polish:

Smooth transitions when tasks are added, completed, or removed. Things shouldn't just pop in and out — they should animate gracefully.
The task input should have a clear active/focus state.
Consider an empty state — when there are no tasks, show something friendly and inviting rather than a blank void.
A subtle count of total vs. completed tasks somewhere would be a nice touch.


Data & Persistence
Tasks need to persist across sessions and across different users/browsers. This is a shared public board, not local-only storage. Use whatever persistence approach makes sense for the platform you're building on, but the key requirement is: if I add a task and my friend opens the app on their phone, they see my task.

What's Out of Scope

User accounts, login, authentication
Task assignment, due dates, priorities, categories, or tags
Drag-and-drop reordering
Real-time live sync (if tasks update on refresh, that's fine — no need for websockets)
Admin panel or moderation tools
Export/import functionality


Quality Bar
This is a demo/test project but it should feel finished. No placeholder text, no broken states, no unstyled elements. Someone should be able to open this and think "oh, this is a real app" — not "oh, this is a prototype." Pay attention to the details: loading states, error handling, edge cases like very long task text, and how the app feels when it's empty vs. when it has 50 tasks.`,
    needsBuild: true,
    expectedFiles: ['index.html', 'package.json'],
    verifyDeploy: (html) =>
      html.includes('<div id="root">') || html.includes('<script') || html.toLowerCase().includes('taskmaster'),
    timeoutMs: 600_000,
  },
];
