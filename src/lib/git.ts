import 'server-only';

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';

import { contentLibraryRoot } from '@/lib/paths';

const execFileAsync = promisify(execFile);

// The submodule is a pure data source — the only git operation this app
// ever runs against it is a pull to refresh content. A fresh SSH connection
// to GitHub from this machine takes ~2.5-3s (network handshake); ControlMaster
// reuses one multiplexed connection across repeated pulls within a session.
// Scoped via GIT_SSH_COMMAND (not the user's ~/.ssh/config) so it only
// affects this app's own git calls.
//
// The socket path MUST be short: AF_UNIX paths are capped at ~104 bytes on
// macOS. os.tmpdir() looks tempting but resolves to the long per-user
// /var/folders/.../T/ path there, which blows that limit — use a fixed
// short directory under /tmp instead (ssh doesn't create it, so ensure it
// exists first).
const sshSocketDir = '/tmp/horror-aids-ssh';
const GIT_SSH_COMMAND = `ssh -o ControlMaster=auto -o ControlPersist=600 -o ControlPath=${sshSocketDir}/%C`;

async function runGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  await fs.mkdir(sshSocketDir, { recursive: true });
  return execFileAsync('git', args, {
    cwd: contentLibraryRoot,
    env: { ...process.env, GIT_SSH_COMMAND },
  });
}

export async function pullSubmodule(): Promise<{ output: string }> {
  const { stdout, stderr } = await runGit(['pull', '--ff-only']);
  return { output: (stdout + stderr).trim() };
}
