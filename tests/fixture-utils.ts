import assert from 'node:assert/strict'
import type {ArchiveFiles} from '../src/types.ts'
/** Text-only fixture output; throws if a requested text file is binary or absent. */
export function requireText(value:ArchiveFiles[string]|undefined):string {
  assert.equal(typeof value,'string','expected a text file')
  return value as string
}
