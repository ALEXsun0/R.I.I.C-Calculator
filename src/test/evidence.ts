import { mkdirSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const artifacts = resolve(dirname(fileURLToPath(import.meta.url)), '../../artifacts')
const root = resolve(artifacts, process.env.RIIC_TEST_EVIDENCE_DIRECTORY ?? 'test-evidence')
if (!root.startsWith(artifacts + sep)) throw new Error('Test evidence directory must stay inside artifacts')

/** Keep fresh test outputs separate from the historical inputs and audit records. */
export function testEvidenceFile(filename: string): string {
  const target = resolve(root, filename)
  if (!target.startsWith(root + sep)) throw new Error('Test evidence must stay inside its artifacts directory')
  mkdirSync(dirname(target), { recursive: true })
  return target
}
