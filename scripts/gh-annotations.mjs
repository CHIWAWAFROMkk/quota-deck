// node:test reporter for CI: each failing test becomes a GitHub annotation, readable
// from the public checks API without downloading the (auth-only) job log.
import path from 'node:path';

const clean = value => String(value ?? '').replace(/%/g, '%25').replace(/\r?\n/g, '%0A');
const property = value => clean(value).replace(/,/g, '%2C').replace(/:/g, '%3A');

export default async function* annotations(source) {
  for await (const event of source) {
    if (event.type !== 'test:fail' || event.data.details?.type === 'suite') continue;
    const { name, file, line } = event.data;
    const error = event.data.details?.error;
    const message = error?.cause?.stack ?? error?.cause?.message ?? error?.message ?? 'failed';
    const where = file ? `file=${property(path.relative(process.cwd(), file).split(path.sep).join('/'))},line=${line ?? 1},` : '';
    yield `::error ${where}title=${property(name)}::${clean(String(message).slice(0, 1500))}\n`;
  }
}
