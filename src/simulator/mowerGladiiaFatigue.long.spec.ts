import {readFileSync} from 'node:fs'
import {expect,it} from 'vitest'
import {importMowerJson} from '../workbench/compat/mowerJson'
import {runCalculationBridge} from '../workbench/calculationBridge'

it('keeps the nine-backup legacy roster complete after fatigue recovery stacking is corrected',async()=>{
 // Let Vitest publish the task before entering the synchronous long simulation.
 await new Promise(resolve=>setTimeout(resolve,150))
 const workspace=importMowerJson(readFileSync(new URL('../../validation/mower-backup-2026-09-22/roster.json',import.meta.url),'utf8'))
 const before=structuredClone(workspace)
 const result=runCalculationBridge(workspace,{engine:'simulation',simulationOptions:{
  schedulingModel:'mower-default',warmupHours:72,sampleHours:168,
  warmupModel:'hourly',recordSegments:true,maxEvents:50000,
  production:{outputMode:'potential',runOrderMode:'ideal',droneTarget:'exp',seed:42},
 },simulationAssumptions:{restingThreshold:.65,rescueThreshold:.75,fiammettaThreshold:.9,fiammettaFool:false,freeRoom:false}})
 expect(result.error).toBeUndefined()
 expect(result.simulationReport?.success,JSON.stringify(result.simulationReport?.diagnostics)).toBe(true)
 expect(result.simulationReport?.elapsedHours).toBe(240)
 const gladiia=result.simulationReport!.operators.find(op=>op.operatorId==='char_474_glady')
 expect(gladiia).toBeDefined()
 // The recovery stacking correction in e58cc77 changes this legacy sample:
 // 刺玫's extra 0.1/h at mood <=18 now stacks with other group recovery.
 // Replacing only dormitoryRecovery.ts with its pre-fix version restores
 // PR10's 2.1964869858310814 exhausted hours within 1e-8. This snapshot
 // records the corrected rule; the roster still does not guarantee zero fatigue.
 // The healthy-provider grant to fatigued hunters has separate boundary tests.
 expect(gladiia!.exhaustedHours).toBeCloseTo(0.007896864444444445,8)
 expect(workspace).toEqual(before)
 expect(workspace.compatibility.backupPlans).toHaveLength(9)
 // Preserve all nine conditions; recovery changes can legitimately prevent a
 // conditional plan from becoming true in this window. Each original trigger
 // has its own false/true execution test in backupPlans.spec.ts.
 const activated=new Set(result.simulationReport!.events.filter(event=>event.type==='backup-plan'&&event.active).map(event=>event.backupIndex))
 expect(activated.has(6)).toBe(true)
 expect(activated.has(8)).toBe(true)
 expect(result.simulationReport!.diagnostics.some(d=>['BACKUP_EXTERNAL_CONDITION_SKIPPED','BACKUP_EXECUTION_FAILED'].includes(d.code))).toBe(false)
 const score=result.report?.summary?.totalScore82
 expect(score).toBeGreaterThanOrEqual(109000)
 expect(score).toBeLessThanOrEqual(109500)
},120000)
