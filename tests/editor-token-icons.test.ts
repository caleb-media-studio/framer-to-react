import test from 'node:test'
import assert from 'node:assert/strict'
import {createDesignTokens} from '../src/design-tokens.ts'
import {resolveExactIcon} from '../src/icon-resolver.ts'
test('Framer token fallback preserves captured reference and literal fallback',()=>{
 const t=createDesignTokens({'library/styles.json':JSON.stringify({colors:[{id:'known',name:'Muted',light:'#9198a1',dark:'#111111'}]})})
 assert.equal(t.resolve('var(--token-known, rgb(145, 152, 161))'),'var(--framer-muted)')
 assert.equal(t.resolve('var(--token-absent, rgb(145, 152, 161))'),'rgb(145, 152, 161)')
 assert.equal(t.resolve('var(--token-absent, evil; color: red)'),null)
 assert.deepEqual(t.report().unknownIds,['absent'])
})
test('exact registry keys and declared aliases resolve Framer display names without fuzzy variants',async()=>{
 assert.equal((await resolveExactIcon('Git Pull Request','Lucide'))?.key,'git-pull-request')
 assert.equal((await resolveExactIcon('Circle User','Lucide'))?.key,'circle-user')
 assert.equal((await resolveExactIcon('History','Lucide'))?.key,'rotate-ccw-clock')
 assert.equal(await resolveExactIcon('Code Branch','Flowbite'),null)
 assert.equal(await resolveExactIcon('Unrecognized Name','Lucide'),null)
})

test('captured Flowbite stroke control selects the outline registry entry',async()=>{
 assert.equal((await resolveExactIcon('Code Branch','Flowbite',{strokeWidth:2}))?.key,'code-branch-outline')
 assert.equal(await resolveExactIcon('Code Branch','Flowbite'),null)
})
