import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ClipboardIO {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export class MacClipboardIO implements ClipboardIO {
  async read(): Promise<string> {
    const { stdout } = await execFileAsync('pbpaste');
    return stdout;
  }

  async write(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile('pbcopy', [], (error) => {
        if (error) reject(error);
        else resolve();
      });
      child.on('error', reject);
      child.stdin?.write(text);
      child.stdin?.end();
    });
  }
}
