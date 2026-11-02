// Writes schema/answer-file.schema.json from the code (npm run schema, after npm run build).
// test/answerFile.test.ts fails if the file is out of date.
import { writeFileSync } from 'node:fs';
import { ANSWER_FILE_SCHEMA } from '../dist/answerFile.js';

writeFileSync(new URL('../schema/answer-file.schema.json', import.meta.url), `${JSON.stringify(ANSWER_FILE_SCHEMA, null, 2)}\n`);
console.log('schema/answer-file.schema.json written');
