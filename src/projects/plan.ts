// Mirrors planFolders() in server/scaffold-project.mjs so the GUI can preview the folders before creating them.

const pad = (n: number) => String(n).padStart(2, '0');

export interface ProjectFolders {
  process: string[];
  system: string;
  skills: string;
  attach: string;
  iteration: string;
  journal: string;
}

export function planFolders(process: string[]): ProjectFolders {
  const steps = process.filter((s) => s.trim()).length ? process.filter((s) => s.trim()) : ['Ideas', 'In Progress', 'Done'];
  const n = steps.length;
  return {
    process: steps.map((name, i) => `${pad(i)} ${name.trim()}`),
    system: `${pad(n)} System`,
    skills: `${pad(n + 1)} Skills`,
    attach: `${pad(n + 2)} Attachments`,
    iteration: `${pad(n + 3)} Iteration Logs`,
    journal: `${pad(n + 4)} Journal`,
  };
}

/** Tree lines for the preview, same layout the scaffolder creates. */
export function treeLines(name: string, process: string[]): string[] {
  const f = planFolders(process);
  return [
    `projects\\${name || '…'}\\`,
    '├─ CLAUDE.md  MAP.md  COMMANDS.md  project.json',
    '├─ .claude\\commands\\  (9 slash commands)',
    '├─ .claude\\settings.json  (hooks)',
    ...f.process.map((p) => `├─ ${p}\\`),
    `├─ ${f.system}\\  IMPLEMENTATION_BRIEF.md, hooks\\`,
    `├─ ${f.skills}\\`,
    `├─ ${f.attach}\\  Knowledge References\\, Project References\\`,
    `├─ ${f.iteration}\\`,
    `└─ ${f.journal}\\  DECISIONS, RESEARCH, SESSIONS, code-log\\`,
  ];
}
