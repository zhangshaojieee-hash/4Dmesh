import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const loadPathUtils = async () => {
  const source = read('src/utils/path.ts');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  return import(url);
};

const loadApiModule = async () => {
  const pathSource = read('src/utils/path.ts');
  const pathOutput = ts.transpileModule(pathSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const pathUrl = `data:text/javascript;base64,${Buffer.from(pathOutput).toString('base64')}`;

  const source = read('src/services/api.ts')
    .replace("import axios, { type AxiosRequestConfig } from 'axios';", "const axios = globalThis.__testAxios;")
    .replace("import type { TaskStatus } from '../types';\n", '')
    .replace("import { getFileName, getFilePathSegment } from '../utils/path';", `import { getFileName, getFilePathSegment } from '${pathUrl}';`)
    .replace(/import\.meta\.env\.VITE_API_BASE_URL/g, 'undefined');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
    },
  }).outputText;
  const url = `data:text/javascript;base64,${Buffer.from(output).toString('base64')}`;
  return import(url);
};

describe('shared path helpers', () => {
  it('normalizes Windows separators before extracting names and extensions', async () => {
    const { getFileName, getFileExtension, getFilePathSegment } = await loadPathUtils();
    assert.equal(getFileName('C:\\tmp\\demo\\sample.model.glb?download=1#part'), 'sample.model.glb');
    assert.equal(getFileName('uploads/models/example.gcode'), 'example.gcode');
    assert.equal(getFileExtension('C:\\tmp\\demo\\sample.model.glb?download=1'), 'glb');
    assert.equal(getFileExtension('/tmp/no-extension'), '');
    assert.equal(getFilePathSegment('C:\\tmp\\demo\\sample model.glb?download=1#part'), 'sample%20model.glb');
    assert.equal(getFilePathSegment('sample%20model.glb'), 'sample%20model.glb');
  });

  it('keeps the frontend pages on the shared helper instead of local split logic', () => {
    const aiCreate = read('src/pages/AICreate.tsx');
    const deviceControl = read('src/pages/DeviceControl.tsx');
    const gcodeEditor = read('src/pages/GcodeEditor.tsx');
    const profile = read('src/pages/Profile.tsx');

    assert.match(aiCreate, /import \{ getFileExtension, getFileName \} from '\.\.\/utils\/path';/);
    assert.match(deviceControl, /import \{ getFileName \} from '\.\.\/utils\/path';/);
    assert.match(gcodeEditor, /import \{ getFileName \} from '\.\.\/utils\/path';/);
    assert.match(profile, /getAvatarUrl,/);
    assert.doesNotMatch(aiCreate, /split\('\?'\)\[0\]\.split\('\/'\)\.pop\(\)/);
    assert.doesNotMatch(deviceControl, /split\('\/'\)\.pop\(\).*split\\\('\\'\\\)\.pop\(/);
    assert.doesNotMatch(gcodeEditor, /split\('\/'\)\.pop\(\).*split\\\('\\'\\\)\.pop\(/);
    assert.doesNotMatch(profile, /\/api\/users\/avatar\/\$\{/);
  });

  it('normalizes file path segments before building API URLs and payloads', async () => {
    const calls = [];
    globalThis.localStorage = {
      getItem() {
        return null;
      },
      removeItem() {},
    };
    globalThis.window = {
      location: {
        pathname: '/',
        search: '',
        replace() {},
      },
    };
    globalThis.__testAxios = {
      create() {
        return {
          interceptors: {
            request: { use() {} },
            response: { use() {} },
          },
          get(url) {
            calls.push(['get', url]);
            return Promise.resolve({ data: {} });
          },
          post(url, data) {
            calls.push(['post', url, data]);
            return Promise.resolve({ data: {} });
          },
          put() {
            return Promise.resolve({ data: {} });
          },
          delete() {
            return Promise.resolve({ data: {} });
          },
        };
      },
    };
    const api = await loadApiModule();

    assert.equal(
      api.getModelDownloadUrl('C:\\tmp\\demo\\sample model.glb'),
      '/api/models/download/sample%20model.glb',
    );
    assert.equal(
      api.getModelFileUrl('C:\\tmp\\demo\\sample model.glb'),
      '/api/models/file/sample%20model.glb',
    );
    assert.equal(
      api.getThumbnailUrl('uploads\\thumbnails\\cover image.png'),
      '/api/models/thumbnail/cover%20image.png',
    );
    assert.equal(
      api.getAvatarUrl('C:\\tmp\\avatars\\user avatar.png'),
      '/api/users/avatar/user%20avatar.png',
    );
    assert.equal(api.downloadGcodeUrl('sample%20model.gcode'), '/api/gcode/download/sample%20model.gcode');

    await api.getGcodeContent('C:\\tmp\\demo\\job 1.gcode');
    await api.saveGcode('C:\\tmp\\demo\\job 1.gcode', 'G1 X0');
    await api.uploadGcodeToDevice('1', 'C:\\tmp\\demo\\job 1.gcode');

    assert.deepEqual(calls[0], ['get', '/gcode/content/job%201.gcode']);
    assert.deepEqual(calls[1], ['post', '/gcode/save', { filename: 'job 1.gcode', content: 'G1 X0' }]);
    assert.deepEqual(calls[2], ['post', '/devices/1/upload-gcode', { filename: 'job 1.gcode', start_print: false, model_id: undefined, model_name: undefined }]);
    delete globalThis.__testAxios;
    delete globalThis.localStorage;
    delete globalThis.window;
  });
});
