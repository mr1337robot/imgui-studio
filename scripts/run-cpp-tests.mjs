import { spawnSync } from 'node:child_process';

const preset = process.platform === 'win32' ? 'native-msvc' : 'native-ninja';

run('cmake', ['--preset', preset]);
run('cmake', ['--build', '--preset', preset]);
run('ctest', ['--preset', preset]);

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    console.error(`Unable to start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
